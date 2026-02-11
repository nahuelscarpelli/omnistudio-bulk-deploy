#!/usr/bin/env node
/**
 * OmniStudio Bulk Deploy - Revenue Cloud (Standard Objects)
 * 
 * Lee un JSON de config con todos los componentes y:
 *   - Export masivo desde la org source
 *   - Import en orden correcto (DM → IP → FC → OS) a cada org target
 * 
 * Uso:
 *   node omnistudio-bulk.js export                          # export todo
 *   node omnistudio-bulk.js export --only DM,IP             # solo DataMappers e IPs
 *   node omnistudio-bulk.js export --filter DMNAdd          # solo los que matcheen
 *   node omnistudio-bulk.js import                          # import a todas las target orgs
 *   node omnistudio-bulk.js import --org "RCA QA"           # import solo a QA
 *   node omnistudio-bulk.js migrate                         # export + import todo
 *   node omnistudio-bulk.js migrate --org "RCA UAT"         # export + import solo a UAT
 *   node omnistudio-bulk.js list                            # listar componentes del config
 *   node omnistudio-bulk.js discover --org "RCA Dev"        # auto-descubrir IDs faltantes
 * 
 * Config: deploy-config.json (en el mismo directorio)
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ─── LOAD CONFIG ─────────────────────────────────────────────────────────────

const CONFIG_FILE = path.join(process.cwd(), 'deploy-config.json');
if (!fs.existsSync(CONFIG_FILE)) {
    console.error(`❌ No se encontró ${CONFIG_FILE}`);
    console.error(`   Creá el archivo con la estructura esperada (ver README).`);
    process.exit(1);
}
const CONFIG = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));

// Filtrar entries inválidas — name y type son obligatorios, id es opcional
CONFIG.components = (CONFIG.components || []).filter(c => {
    if (!c || typeof c !== 'object') return false;
    if (!c.name || !c.type) {
        console.warn(`⚠️  Componente ignorado (falta name o type): ${JSON.stringify(c)}`);
        return false;
    }
    if (!['DM', 'IP', 'OS', 'FC'].includes(c.type)) {
        console.warn(`⚠️  Tipo inválido "${c.type}" para ${c.name}. Usar: DM, IP, OS, FC`);
        return false;
    }
    return true;
});

// ─── SOQL TEMPLATES ──────────────────────────────────────────────────────────

const SOQL = {
    OS: (where) => `SELECT IsMetadataCacheDisabled, IsTestProcedure, Description, OverrideKey, Name, OmniProcessKey, Language, PropertySetConfig, LastPreviewPage, OmniProcessType, ElementTypeComponentMapping, SubType, ResponseCacheType, IsOmniScriptEmbeddable, CustomJavaScript, IsIntegrationProcedure, VersionNumber, DesignerCustomizationType, Namespace, Type, RequiredPermission, WebComponentKey, IsWebCompEnabled, (SELECT Description, DesignerCustomizationType, Name, EmbeddedOmniScriptKey, IsActive, Type, ParentElementId, PropertySetConfig, SequenceNumber, Level, Id FROM OmniProcessElements) FROM OmniProcess WHERE OmniProcessType = 'OmniScript' AND ${where}`,

    IP: (where) => `SELECT IsMetadataCacheDisabled, IsTestProcedure, Description, OverrideKey, Name, OmniProcessKey, Language, PropertySetConfig, LastPreviewPage, OmniProcessType, ElementTypeComponentMapping, SubType, ResponseCacheType, IsOmniScriptEmbeddable, CustomJavaScript, IsIntegrationProcedure, VersionNumber, DesignerCustomizationType, Namespace, Type, RequiredPermission, WebComponentKey, IsWebCompEnabled, (SELECT Description, DesignerCustomizationType, Name, EmbeddedOmniScriptKey, IsActive, Type, ParentElementId, PropertySetConfig, SequenceNumber, Level, Id FROM OmniProcessElements) FROM OmniProcess WHERE OmniProcessType = 'Integration Procedure' AND ${where}`,

    DM: (where) => `SELECT Id, SourceObject, ExpectedInputOtherData, ExpectedOutputJson, Description, ExpectedOutputXml, IsDeletedOnSuccess, IsProcessSuperBulk, OverrideKey, PreviewOtherData, SynchronousProcessThreshold, TargetOutputDocumentIdentifier, GlobalKey, Name, IsAssignmentRulesUsed, IsXmlDeclarationRemoved, XmlOutputTagsOrder, IsSourceObjectDefault, InputParsingClass, ExpectedOutputOtherData, PreviewSourceObjectData, OutputType, PreviewJsonData, IsRollbackOnError, BatchSize, ResponseCacheType, IsNullInputsIncludedInOutput, VersionNumber, OutputParsingClass, Type, IsErrorIgnored, ExpectedInputJson, ExpectedInputXml, RequiredPermission, PreviewXmlData, InputType, ResponseCacheTtlMinutes, TargetOutputFileName, IsFieldLevelSecurityEnabled, PreprocessorClassName, (SELECT Id, MigrationPattern, InputObjectQuerySequence, FormulaResultPath, FormulaSequence, LinkedFieldName, IsDisabled, MigrationCategory, MigrationType, OutputFieldName, MigrationValue, FilterGroup, LinkedObjectSequence, GlobalKey, Name, OutputCreationSequence, DefaultValue, LookupReturnedFieldName, IsRequiredForUpsert, MigrationProcess, FilterDataType, InputObjectName, FormulaExpression, LookupObjectName, MigrationAttribute, MigrationGroup, FilterValue, FilterOperator, InputFieldName, MigrationKey, IsUpsertKey, LookupByFieldName, OutputFieldFormat, TransformValueMappings, OutputObjectName FROM OmniDataTransformItems) FROM OmniDataTransform WHERE ${where}`,

    FC: (where) => `SELECT Id, Description, AuthorName, OmniUiCardKey, OverrideKey, DataSourceConfig, SampleDataSourceResponse, ClonedFromOmniUiCardKey, VersionNumber, Namespace, Name, IsTrackingEnabled, PropertySetConfig, OmniUiCardType, StylingConfiguration, UniqueName FROM OmniUiCard WHERE ${where}`
};

const PLAN_FILE = {
    OS: "OmniProcess-OmniProcessElement-plan.json",
    IP: "OmniProcess-OmniProcessElement-plan.json",
    DM: "OmniDataTransform-OmniDataTransformItem-plan.json",
    FC: "OmniUiCard-plan.json"
};

const LABEL = { OS: "OmniScript", IP: "Integration Procedure", DM: "DataMapper", FC: "FlexCard" };
const DIR_NAME = { OS: "omniscripts", IP: "IPs", DM: "datamappers", FC: "flexcards" };

// Orden correcto de deploy
const DEPLOY_ORDER = ['DM', 'IP', 'FC', 'OS'];

// ─── CLI HELPERS ─────────────────────────────────────────────────────────────

function run(cmd, opts = {}) {
    try {
        return execSync(cmd, { encoding: 'utf-8', timeout: 120000, ...opts });
    } catch (e) {
        if (opts.ignoreError) return null;
        throw e;
    }
}

function sfQuery(query, org) {
    const escaped = query.replace(/"/g, '\\"');
    // Intentar sf primero, fallback a sfdx
    for (const cmd of [
        `sf data query -q "${escaped}" -o "${org}" --json`,
        `sfdx force:data:soql:query -q "${escaped}" -u "${org}" --json`
    ]) {
        try {
            const res = JSON.parse(run(cmd));
            return res.result?.records || [];
        } catch { continue; }
    }
    return [];
}

function sfTreeExport(query, org, dir) {
    fs.mkdirSync(dir, { recursive: true });
    const escaped = query.replace(/"/g, '\\"');
    for (const cmd of [
        `sf data export tree -q "${escaped}" -o "${org}" -p -d "${dir}"`,
        `sfdx force:data:tree:export -q "${escaped}" -u "${org}" -p -d "${dir}"`
    ]) {
        try {
            run(cmd, { stdio: 'inherit' });
            return true;
        } catch { continue; }
    }
    return false;
}

function sfTreeImport(planPath, org) {
    const cmds = [
        `sf data import tree -p "${planPath}" -o "${org}"`,
        `sfdx force:data:tree:import -p "${planPath}" -u "${org}"`
    ];
    for (const cmd of cmds) {
        try {
            run(cmd, { stdio: 'inherit' });
            return true;
        } catch (e) {
            const msg = e.stderr?.toString() || e.stdout?.toString() || e.message || '';
            // Si el error es de datos (ej: duplicado), no intentar fallback
            if (msg.includes('FIELD_INTEGRITY') || msg.includes('DUPLICATE') || msg.includes('already taken')) {
                console.error(`  ⚠️  Ya existe en destino. Usá --force para borrar y reimportar.`);
                return false;
            }
            continue;
        }
    }
    return false;
}

function deleteExisting(type, name, org) {
    let query = '';
    if (type === 'DM') query = `SELECT Id FROM OmniDataTransform WHERE Name='${name}'`;
    else if (type === 'IP') query = `SELECT Id FROM OmniProcess WHERE (Name='${name}' OR SubType='${name}') AND OmniProcessType='Integration Procedure'`;
    else if (type === 'OS') query = `SELECT Id FROM OmniProcess WHERE (Name='${name}' OR SubType='${name}') AND OmniProcessType='OmniScript'`;
    else if (type === 'FC') query = `SELECT Id FROM OmniUiCard WHERE Name='${name}' OR UniqueName='${name}'`;

    const records = sfQuery(query, org);
    if (records.length === 0) return;

    for (const r of records) {
        console.log(`  🗑️  Borrando ${LABEL[type]} existente: ${name} (${r.Id})`);
        for (const cmd of [
            `sf data delete record -s ${getObjectName(type)} -i ${r.Id} -o "${org}" --json`,
            `sfdx force:data:record:delete -s ${getObjectName(type)} -i ${r.Id} -u "${org}" --json`
        ]) {
            try { run(cmd); break; } catch { continue; }
        }
    }
}

function getObjectName(type) {
    const map = { DM: 'OmniDataTransform', IP: 'OmniProcess', OS: 'OmniProcess', FC: 'OmniUiCard' };
    return map[type];
}

// ─── GROUP COMPONENTS BY TYPE ────────────────────────────────────────────────

function groupByType(components) {
    const groups = { DM: [], IP: [], FC: [], OS: [] };
    for (const c of components) {
        groups[c.type].push(c);
    }
    return groups;
}

// ─── AUTO-DISCOVER: completar IDs faltantes antes de operar ─────────────────

function ensureResolved(components, org) {
    const missingIds = components.filter(c => !c.id);
    if (missingIds.length > 0) {
        console.log(`\n🔄 ${missingIds.length} componente(s) sin ID, ejecutando discover automático...`);
        doDiscover(components, org);
    }
    return components;
}

// ─── EXPORT ──────────────────────────────────────────────────────────────────

function doExport(components, sourceOrg, baseDir) {
    components = ensureResolved(components, sourceOrg);
    const groups = groupByType(components);
    const results = { success: [], failed: [] };

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  📤 EXPORT MASIVO`);
    console.log(`  Org: ${sourceOrg}`);
    console.log(`  Componentes: ${components.length}`);
    console.log(`    DM: ${groups.DM.length} | IP: ${groups.IP.length} | FC: ${groups.FC.length} | OS: ${groups.OS.length}`);
    console.log(`${'═'.repeat(60)}\n`);

    // ── DMs: export en batch con WHERE Name IN (...) ──
    if (groups.DM.length > 0) {
        console.log(`\n── DataMappers (${groups.DM.length}) ──`);
        const names = groups.DM.map(c => `'${c.name}'`).join(',');
        const dir = path.join(baseDir, DIR_NAME.DM);
        const query = SOQL.DM(`Name IN (${names})`);

        console.log(`  Exportando batch: ${groups.DM.map(c => c.name).join(', ')}`);
        if (sfTreeExport(query, sourceOrg, dir)) {
            groups.DM.forEach(c => results.success.push(c));
        } else {
            console.error(`  ❌ Falló el export batch de DMs. Intentando uno por uno...`);
            for (const c of groups.DM) {
                const singleDir = path.join(baseDir, DIR_NAME.DM, c.name);
                const q = SOQL.DM(`Name='${c.name}'`);
                if (sfTreeExport(q, sourceOrg, singleDir)) {
                    results.success.push(c);
                } else {
                    console.error(`  ❌ ${c.name}`);
                    results.failed.push(c);
                }
            }
        }
    }

    // ── IPs: export por ID o por Name ──
    if (groups.IP.length > 0) {
        console.log(`\n── Integration Procedures (${groups.IP.length}) ──`);
        for (const c of groups.IP) {
            const dir = path.join(baseDir, DIR_NAME.IP, c.name);
            const where = c.id ? `Id='${c.id}'` : `(Name='${c.name}' OR SubType='${c.name}') AND IsActive=true`;
            const query = SOQL.IP(where);

            console.log(`  ${c.name}${c.id ? ` (${c.id})` : ''}`);
            if (sfTreeExport(query, sourceOrg, dir)) {
                results.success.push(c);
            } else {
                console.error(`  ❌ ${c.name}`);
                results.failed.push(c);
            }
        }
    }

    // ── FCs: export por ID o por Name ──
    if (groups.FC.length > 0) {
        console.log(`\n── FlexCards (${groups.FC.length}) ──`);
        for (const c of groups.FC) {
            const dir = path.join(baseDir, DIR_NAME.FC, c.name);
            const where = c.id ? `Id='${c.id}'` : `(Name='${c.name}' OR UniqueName='${c.name}') AND IsActive=true`;
            const query = SOQL.FC(where);

            console.log(`  ${c.name}${c.id ? ` (${c.id})` : ''}`);
            if (sfTreeExport(query, sourceOrg, dir)) {
                results.success.push(c);
            } else {
                console.error(`  ❌ ${c.name}`);
                results.failed.push(c);
            }
        }
    }

    // ── OS: export por ID o por Name ──
    if (groups.OS.length > 0) {
        console.log(`\n── OmniScripts (${groups.OS.length}) ──`);
        for (const c of groups.OS) {
            const dir = path.join(baseDir, DIR_NAME.OS, c.name);
            const where = c.id ? `Id='${c.id}'` : `(Name='${c.name}' OR SubType='${c.name}') AND IsActive=true`;
            const query = SOQL.OS(where);

            console.log(`  ${c.name}${c.id ? ` (${c.id})` : ''}`);
            if (sfTreeExport(query, sourceOrg, dir)) {
                results.success.push(c);
            } else {
                console.error(`  ❌ ${c.name}`);
                results.failed.push(c);
            }
        }
    }

    // ── Resumen ──
    printResults('EXPORT', results);
    return results;
}

// ─── IMPORT ──────────────────────────────────────────────────────────────────

function doImport(components, targetOrg, baseDir, force = false) {
    const groups = groupByType(components);
    const results = { success: [], failed: [], skipped: [] };

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  📥 IMPORT → ${targetOrg}${force ? ' (--force: borra existentes)' : ''}`);
    console.log(`  Componentes: ${components.length}`);
    console.log(`  Orden: DM → IP → FC → OS`);
    console.log(`${'═'.repeat(60)}\n`);

    for (const type of DEPLOY_ORDER) {
        const comps = groups[type] || [];
        if (comps.length === 0) continue;

        console.log(`\n── ${LABEL[type]}s (${comps.length}) ──`);

        if (type === 'DM') {
            const batchPlan = path.join(baseDir, DIR_NAME.DM, PLAN_FILE.DM);
            if (fs.existsSync(batchPlan)) {
                try {
                    if (force) {
                        for (const c of comps) deleteExisting('DM', c.name, targetOrg);
                    }
                    console.log(`  Batch import: ${comps.map(c => c.name).join(', ')}`);
                    if (sfTreeImport(batchPlan, targetOrg)) {
                        comps.forEach(c => results.success.push(c));
                    } else {
                        comps.forEach(c => results.failed.push(c));
                    }
                } catch (e) {
                    console.error(`  ❌ DM batch: ${e.message || 'Error desconocido'}`);
                    comps.forEach(c => results.failed.push(c));
                }
            } else {
                for (const c of comps) {
                    const plan = path.join(baseDir, DIR_NAME.DM, c.name, PLAN_FILE.DM);
                    if (!fs.existsSync(plan)) {
                        console.warn(`  ⏭️  ${c.name} (plan no encontrado)`);
                        results.skipped.push(c);
                        continue;
                    }
                    try {
                        if (force) deleteExisting('DM', c.name, targetOrg);
                        console.log(`  ${c.name}`);
                        if (sfTreeImport(plan, targetOrg)) {
                            results.success.push(c);
                        } else {
                            results.failed.push(c);
                        }
                    } catch (e) {
                        console.error(`  ❌ ${c.name}: ${e.message || 'Error desconocido'}`);
                        results.failed.push(c);
                    }
                }
            }
        } else {
            for (const c of comps) {
                const plan = path.join(baseDir, DIR_NAME[type], c.name, PLAN_FILE[type]);
                if (!fs.existsSync(plan)) {
                    console.warn(`  ⏭️  ${c.name} (plan no encontrado)`);
                    results.skipped.push(c);
                    continue;
                }
                try {
                    if (force) deleteExisting(type, c.name, targetOrg);
                    console.log(`  ${c.name}`);
                    if (sfTreeImport(plan, targetOrg)) {
                        results.success.push(c);
                    } else {
                        results.failed.push(c);
                    }
                } catch (e) {
                    console.error(`  ❌ ${c.name}: ${e.message || 'Error desconocido'}`);
                    results.failed.push(c);
                }
            }
        }
    }

    printResults(`IMPORT → ${targetOrg}`, results);
    return results;
}

// ─── DISCOVER: completar IDs faltantes y validar existentes ─────────────────

function doDiscover(components, org) {
    console.log(`\n🔍 Descubriendo componentes en ${org}...\n`);
    let found = 0, corrected = 0, notFound = 0;

    for (const c of components) {
        const records = queryByNameAndType(c.name, c.type, org);

        if (records.length === 0) {
            console.log(`  ❌ ${c.name} (${c.type}) → NO ENCONTRADO`);
            notFound++;
            continue;
        }

        const realId = records[0].Id;

        if (!c.id) {
            // Sin ID → asignar
            c.id = realId;
            console.log(`  ✅ ${c.name} (${c.type}) → ${c.id}`);
            found++;
        } else if (c.id !== realId) {
            // ID no matchea → corregir
            console.log(`  ⚠️  ${c.name} (${c.type}) → ID corregido: ${c.id} → ${realId}`);
            c.id = realId;
            corrected++;
        } else {
            // Todo ok
            console.log(`  ✓ ${c.name} (${c.type}) → ID correcto`);
        }
    }

    // Guardar config actualizado
    CONFIG.components = components;
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(CONFIG, null, 4));
    console.log(`\n📋 deploy-config.json actualizado.`);
    console.log(`   ${found} ID(s) encontrados, ${corrected} corregidos, ${notFound} no encontrados.`);
}

function queryByNameAndType(name, type, org) {
    if (type === 'OS') return sfQuery(`SELECT Id FROM OmniProcess WHERE (Name='${name}' OR SubType='${name}') AND OmniProcessType='OmniScript' AND IsActive=true LIMIT 1`, org);
    if (type === 'IP') return sfQuery(`SELECT Id FROM OmniProcess WHERE (Name='${name}' OR SubType='${name}') AND OmniProcessType='Integration Procedure' AND IsActive=true LIMIT 1`, org);
    if (type === 'DM') return sfQuery(`SELECT Id FROM OmniDataTransform WHERE Name='${name}' LIMIT 1`, org);
    if (type === 'FC') return sfQuery(`SELECT Id FROM OmniUiCard WHERE (Name='${name}' OR UniqueName='${name}') AND IsActive=true LIMIT 1`, org);
    return [];
}

// ─── LIST ────────────────────────────────────────────────────────────────────

function doList(components) {
    const groups = groupByType(components);
    const withId = components.filter(c => c.id).length;

    console.log(`\n📋 Componentes en deploy-config.json (${components.length} total, ${withId} con ID):\n`);

    for (const type of DEPLOY_ORDER) {
        const comps = groups[type] || [];
        if (comps.length === 0) continue;
        console.log(`  ${LABEL[type]}s (${comps.length}):`);
        for (const c of comps) {
            const status = c.id ? '✓' : '⚠️';
            const idStr = c.id ? c.id : 'sin ID (usá discover)';
            console.log(`    ${status} ${c.name}  →  ${idStr}`);
        }
        console.log('');
    }
}

// ─── RESULTS ─────────────────────────────────────────────────────────────────

function printResults(label, results) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`  ${label} - Resumen:`);
    console.log(`    ✅ OK:      ${results.success.length}`);
    if (results.failed.length > 0) {
        console.log(`    ❌ Failed:  ${results.failed.length}`);
        results.failed.forEach(c => console.log(`       - ${c.name} (${c.type})`));
    }
    if (results.skipped?.length > 0) {
        console.log(`    ⏭️  Skipped: ${results.skipped.length}`);
        results.skipped.forEach(c => console.log(`       - ${c.name} (${c.type})`));
    }
    console.log(`${'─'.repeat(60)}\n`);
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
    const p = { command: argv[0] };
    for (let i = 1; i < argv.length; i++) {
        if (argv[i] === '--org' && argv[i + 1]) p.org = argv[++i];
        else if (argv[i] === '--from' && argv[i + 1]) p.from = argv[++i];
        else if (argv[i] === '--to' && argv[i + 1]) p.to = argv[++i];
        else if (argv[i] === '--dir' && argv[i + 1]) p.dir = argv[++i];
        else if (argv[i] === '--only' && argv[i + 1]) p.only = argv[++i].split(',').map(s => s.trim().toUpperCase());
        else if (argv[i] === '--filter' && argv[i + 1]) p.filter = argv[++i];
        else if (argv[i] === '--force') p.force = true;
    }
    return p;
}

function filterComponents(components, args) {
    let filtered = [...components];
    if (args.only) {
        filtered = filtered.filter(c => args.only.includes(c.type));
    }
    if (args.filter) {
        const re = new RegExp(args.filter, 'i');
        filtered = filtered.filter(c => re.test(c.name));
    }
    return filtered;
}

function printUsage() {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║        OmniStudio Bulk Deploy - Revenue Cloud               ║
╚══════════════════════════════════════════════════════════════╝

Comandos:
  export                 Export masivo desde source org
  import                 Import a target org(s)
  migrate                Export + Import de una
  list                   Listar componentes del config
  discover               Buscar IDs faltantes en la org

Opciones:
  --org "alias"          Org específica (override de config)
  --only DM,IP,OS,FC     Filtrar por tipo
  --filter "texto"       Filtrar por nombre (regex)
  --force                Borrar existentes antes de importar
  --dir ./path           Directorio de trabajo

Ejemplos:
  node omnistudio-bulk.js list
  node omnistudio-bulk.js discover --org "RCA Dev"
  node omnistudio-bulk.js export
  node omnistudio-bulk.js export --only DM
  node omnistudio-bulk.js export --filter "DMNCreate"
  node omnistudio-bulk.js import --org "RCA QA"
  node omnistudio-bulk.js import --org "RCA QA" --force
  node omnistudio-bulk.js migrate --org "RCA UAT"
`);
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

const args = parseArgs(process.argv.slice(2));

if (!args.command) {
    printUsage();
    process.exit(0);
}

const baseDir = args.dir || CONFIG.baseDir || './omnistudio';
const components = filterComponents(CONFIG.components, args);

switch (args.command) {
    case 'list':
        doList(components);
        break;

    case 'discover':
        doDiscover(components, args.org || CONFIG.sourceOrg);
        break;

    case 'export':
        doExport(components, args.org || CONFIG.sourceOrg, baseDir);
        break;

    case 'import': {
        const orgs = args.org ? [args.org] : CONFIG.targetOrgs;
        for (const org of orgs) {
            doImport(components, org, baseDir, args.force);
        }
        break;
    }

    case 'migrate': {
        const sourceOrg = args.from || CONFIG.sourceOrg;
        const targetOrgs = args.org ? [args.org] : (args.to ? [args.to] : CONFIG.targetOrgs);
        doExport(components, sourceOrg, baseDir);
        for (const org of targetOrgs) {
            doImport(components, org, baseDir, args.force);
        }
        break;
    }

    default:
        console.error(`❌ Comando desconocido: ${args.command}`);
        printUsage();
        process.exit(1);
}
