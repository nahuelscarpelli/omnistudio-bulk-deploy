# OmniStudio Bulk Deploy

**Bulk deployment tool for Salesforce OmniStudio components in Revenue Cloud / Industries Cloud orgs using standard objects.**

> 🇪🇸 [Versión en Español](#español) más abajo.

[![Donate](https://img.shields.io/badge/Donate-PayPal-blue.svg)](https://paypal.me/nahuelscarpelli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## The Problem

If you work with **Salesforce Revenue Cloud** or **Industries Cloud** (Media, Communications, Energy, etc.) you've probably hit this wall:

- **vlocity_build** doesn't work — your org uses standard objects (`OmniProcess`, `OmniDataTransform`, `OmniUiCard`) instead of Vlocity managed package objects (`vlocity_cmt__*`).
- **sf CLI metadata deploy** doesn't auto-resolve dependencies between components.
- **Manual deployment** through the UI is slow, error-prone, and doesn't scale.

This tool solves all of that. It uses the Salesforce Data API (`sf data export/import tree`) to bulk export and import OmniStudio components across orgs, **respecting dependency order**.

## Supported Component Types

| Type | Code | Standard Object |
|------|------|----------------|
| DataMapper (DataRaptor) | `DM` | `OmniDataTransform` |
| Integration Procedure | `IP` | `OmniProcess` |
| FlexCard | `FC` | `OmniUiCard` |
| OmniScript | `OS` | `OmniProcess` |

## Requirements

- **Node.js** 16+
- **Salesforce CLI** (`sf` or `sfdx`) installed and authenticated to your orgs
- Orgs using **OmniStudio standard objects** (Revenue Cloud, Industries Cloud)

## Installation

```bash
git clone https://github.com/YOUR_USER/omnistudio-bulk-deploy.git
cd omnistudio-bulk-deploy
```

No dependencies to install — it's a single Node.js script using only built-in modules.

## Quick Start

### 1. Configure your components

Edit `deploy-config.json` with your components. **`name` and `type` are required, `id` is optional** (the tool can discover IDs automatically):

```json
{
    "sourceOrg": "MyDev",
    "targetOrgs": ["MyQA", "MyUAT"],
    "baseDir": "./omnistudio",

    "components": [
        { "name": "GetCustomerData",    "type": "DM" },
        { "name": "CreateOrder",        "type": "IP" },
        { "name": "CustomerCard",       "type": "FC" },
        { "name": "CheckoutFlow",       "type": "OS", "id": "0jNxx0000001234AAA" }
    ]
}
```

### 2. Discover IDs (optional but recommended)

```bash
node omnistudio-bulk.js discover --org "MyDev"
```

This queries your org, finds each component's Salesforce ID, **validates existing IDs**, and updates `deploy-config.json` automatically. If an ID doesn't match the name, it gets corrected.

### 3. Export

```bash
node omnistudio-bulk.js export
```

Retrieves all components from the source org and saves them locally.

### 4. Import

```bash
node omnistudio-bulk.js import --org "MyQA"
```

Deploys everything to the target org in the correct dependency order: **DM → IP → FC → OS**.

### 5. Or do it all at once

```bash
node omnistudio-bulk.js migrate --org "MyQA"
```

## Commands

| Command | Description |
|---------|-------------|
| `list` | Show all configured components and their status |
| `discover` | Find/validate IDs in the org and update config |
| `export` | Bulk export from source org |
| `import` | Import to target org(s) in dependency order |
| `migrate` | Export + Import in one step |

## Options

| Flag | Description |
|------|-------------|
| `--org "alias"` | Target a specific org (overrides config) |
| `--only DM,IP,OS,FC` | Filter by component type |
| `--filter "text"` | Filter by name (regex) |
| `--force` | Delete existing components before importing (handles duplicates) |
| `--dir ./path` | Custom working directory |
| `--from "alias"` | Source org for migrate |
| `--to "alias"` | Target org for migrate |

## Usage Examples

```bash
# List all configured components
node omnistudio-bulk.js list

# Discover and validate IDs
node omnistudio-bulk.js discover --org "MyDev"

# Export only DataMappers
node omnistudio-bulk.js export --only DM

# Export components matching a pattern
node omnistudio-bulk.js export --filter "Customer"

# Import to QA with force (deletes existing before import)
node omnistudio-bulk.js import --org "MyQA" --force

# Migrate only IPs and DMs to UAT
node omnistudio-bulk.js migrate --org "MyUAT" --only DM,IP

# Combine filters
node omnistudio-bulk.js export --only DM,IP --filter "Lead"
```

## Deployment Order

The tool always imports in this order to respect dependencies:

```
1. DataMappers (DM)      — No dependencies
2. Integration Procedures (IP) — May reference DataMappers
3. FlexCards (FC)         — May reference DataMappers and IPs
4. OmniScripts (OS)      — May reference IPs, DataMappers, and embed FlexCards
```

## How It Works

- **Export**: Uses `sf data export tree` with full SOQL queries that include child relationships (e.g., `OmniProcessElements` for OmniScripts/IPs, `OmniDataTransformItems` for DataMappers).
- **Import**: Uses `sf data import tree` with plan files generated during export.
- **DataMappers** are exported in batch (`WHERE Name IN (...)`) for efficiency.
- **IPs, FlexCards, OmniScripts** are exported individually to their own directories.
- **Auto-discover**: If you run `export` and some components don't have IDs, the tool automatically runs `discover` first.
- **Validation**: The `discover` command checks that configured IDs actually match the component names in the org, and auto-corrects mismatches.
- **CLI compatibility**: Tries `sf` commands first, falls back to `sfdx` for older CLI versions.

## Directory Structure

After export, your working directory will look like this:

```
omnistudio/
├── datamappers/
│   ├── OmniDataTransform-OmniDataTransformItem-plan.json
│   ├── OmniDataTransforms.json
│   └── OmniDataTransformItems.json
├── IPs/
│   └── CreateOrder/
│       ├── OmniProcess-OmniProcessElement-plan.json
│       ├── OmniProcesses.json
│       └── OmniProcessElements.json
├── flexcards/
│   └── CustomerCard/
│       ├── OmniUiCard-plan.json
│       └── OmniUiCards.json
└── omniscripts/
    └── CheckoutFlow/
        ├── OmniProcess-OmniProcessElement-plan.json
        ├── OmniProcesses.json
        └── OmniProcessElements.json
```

## The `--force` Flag

Since `sf data import tree` performs INSERT operations (not upsert), importing a component that already exists in the target org will fail with a duplicate error. The `--force` flag handles this by:

1. Querying the target org for existing components with the same name
2. Deleting them (including all versions)
3. Then importing the new version

Use with caution — this is destructive.

## Limitations

- This tool works with **standard OmniStudio objects only** (Revenue Cloud / Industries Cloud). It does **not** work with Vlocity managed package objects (`vlocity_cmt__*`, `vlocity_ins__*`). For those, use [vlocity_build](https://github.com/vlocityinc/vlocity_build).
- Components are imported as **new records** (INSERT), not upserted. Use `--force` to replace existing ones.
- Custom LWCs, Apex classes, and custom fields referenced by components are **not** included — deploy those separately via metadata API.
- Imported components will be **inactive** — you need to activate them manually or via a post-deploy script.

## Contributing

Contributions are welcome! Feel free to open issues or submit pull requests.

## Support This Project

If this tool saved you time and headaches, consider buying me a coffee:

[![Donate with PayPal](https://img.shields.io/badge/Donate-PayPal-blue.svg?style=for-the-badge&logo=paypal)](https://paypal.me/nahuelscarpelli)

---

# Español

## OmniStudio Bulk Deploy

**Herramienta de deploy masivo para componentes OmniStudio en orgs de Revenue Cloud / Industries Cloud con objetos estándar.**

## El Problema

Si trabajás con **Salesforce Revenue Cloud** o **Industries Cloud** (Media, Communications, Energy, etc.) seguramente te encontraste con esto:

- **vlocity_build** no funciona — tu org usa objetos estándar (`OmniProcess`, `OmniDataTransform`, `OmniUiCard`) en vez de los objetos del managed package de Vlocity (`vlocity_cmt__*`).
- **sf CLI metadata deploy** no resuelve dependencias automáticamente entre componentes.
- **Deploy manual** por la UI es lento, propenso a errores y no escala.

Esta herramienta resuelve todo eso. Usa la Data API de Salesforce (`sf data export/import tree`) para exportar e importar componentes OmniStudio entre orgs, **respetando el orden de dependencias**.

## Tipos de Componentes Soportados

| Tipo | Código | Objeto Estándar |
|------|--------|----------------|
| DataMapper (DataRaptor) | `DM` | `OmniDataTransform` |
| Integration Procedure | `IP` | `OmniProcess` |
| FlexCard | `FC` | `OmniUiCard` |
| OmniScript | `OS` | `OmniProcess` |

## Requisitos

- **Node.js** 16+
- **Salesforce CLI** (`sf` o `sfdx`) instalado y autenticado en tus orgs
- Orgs con **objetos estándar de OmniStudio** (Revenue Cloud, Industries Cloud)

## Instalación

```bash
git clone https://github.com/YOUR_USER/omnistudio-bulk-deploy.git
cd omnistudio-bulk-deploy
```

No hay dependencias que instalar — es un solo script de Node.js que usa módulos nativos.

## Inicio Rápido

### 1. Configurá tus componentes

Editá `deploy-config.json` con tus componentes. **`name` y `type` son obligatorios, `id` es opcional** (la herramienta puede descubrir IDs automáticamente):

```json
{
    "sourceOrg": "MiDev",
    "targetOrgs": ["MiQA", "MiUAT"],
    "baseDir": "./omnistudio",

    "components": [
        { "name": "GetCustomerData",    "type": "DM" },
        { "name": "CreateOrder",        "type": "IP" },
        { "name": "CustomerCard",       "type": "FC" },
        { "name": "CheckoutFlow",       "type": "OS", "id": "0jNxx0000001234AAA" }
    ]
}
```

### 2. Descubrir IDs (opcional pero recomendado)

```bash
node omnistudio-bulk.js discover --org "MiDev"
```

Consulta tu org, encuentra el ID de cada componente, **valida los IDs existentes** y actualiza `deploy-config.json` automáticamente. Si un ID no matchea con el nombre, lo corrige.

### 3. Exportar

```bash
node omnistudio-bulk.js export
```

Recupera todos los componentes de la org origen y los guarda localmente.

### 4. Importar

```bash
node omnistudio-bulk.js import --org "MiQA"
```

Deploya todo a la org destino en el orden correcto de dependencias: **DM → IP → FC → OS**.

### 5. O todo de una

```bash
node omnistudio-bulk.js migrate --org "MiQA"
```

## Comandos

| Comando | Descripción |
|---------|-------------|
| `list` | Muestra todos los componentes configurados y su estado |
| `discover` | Busca/valida IDs en la org y actualiza el config |
| `export` | Export masivo desde la org origen |
| `import` | Import a org(s) destino en orden de dependencias |
| `migrate` | Export + Import en un solo paso |

## Opciones

| Flag | Descripción |
|------|-------------|
| `--org "alias"` | Apuntar a una org específica (override del config) |
| `--only DM,IP,OS,FC` | Filtrar por tipo de componente |
| `--filter "texto"` | Filtrar por nombre (regex) |
| `--force` | Borrar componentes existentes antes de importar (maneja duplicados) |
| `--dir ./path` | Directorio de trabajo personalizado |
| `--from "alias"` | Org origen para migrate |
| `--to "alias"` | Org destino para migrate |

## Ejemplos de Uso

```bash
# Listar todos los componentes configurados
node omnistudio-bulk.js list

# Descubrir y validar IDs
node omnistudio-bulk.js discover --org "MiDev"

# Exportar solo DataMappers
node omnistudio-bulk.js export --only DM

# Exportar componentes que matcheen un patrón
node omnistudio-bulk.js export --filter "Customer"

# Importar a QA con force (borra existentes antes de importar)
node omnistudio-bulk.js import --org "MiQA" --force

# Migrar solo IPs y DMs a UAT
node omnistudio-bulk.js migrate --org "MiUAT" --only DM,IP

# Combinar filtros
node omnistudio-bulk.js export --only DM,IP --filter "Lead"
```

## Orden de Deploy

La herramienta siempre importa en este orden para respetar dependencias:

```
1. DataMappers (DM)             — Sin dependencias
2. Integration Procedures (IP)  — Pueden referenciar DataMappers
3. FlexCards (FC)               — Pueden referenciar DataMappers e IPs
4. OmniScripts (OS)             — Pueden referenciar IPs, DataMappers y embeber FlexCards
```

## Cómo Funciona

- **Export**: Usa `sf data export tree` con queries SOQL completas que incluyen relaciones hijo (ej: `OmniProcessElements` para OmniScripts/IPs, `OmniDataTransformItems` para DataMappers).
- **Import**: Usa `sf data import tree` con archivos plan generados durante el export.
- **DataMappers** se exportan en batch (`WHERE Name IN (...)`) para mayor eficiencia.
- **IPs, FlexCards, OmniScripts** se exportan individualmente a sus propios directorios.
- **Auto-discover**: Si corrés `export` y algunos componentes no tienen ID, la herramienta ejecuta `discover` automáticamente primero.
- **Validación**: El comando `discover` verifica que los IDs configurados matcheen con los nombres de los componentes en la org, y auto-corrige discrepancias.
- **Compatibilidad CLI**: Intenta comandos `sf` primero, fallback a `sfdx` para versiones anteriores del CLI.

## El Flag `--force`

Como `sf data import tree` hace operaciones INSERT (no upsert), importar un componente que ya existe en la org destino va a fallar con un error de duplicado. El flag `--force` maneja esto:

1. Consulta la org destino buscando componentes existentes con el mismo nombre
2. Los borra (incluyendo todas las versiones)
3. Luego importa la versión nueva

Usá con precaución — es destructivo.

## Limitaciones

- Esta herramienta funciona **solo con objetos estándar de OmniStudio** (Revenue Cloud / Industries Cloud). **No** funciona con objetos del managed package de Vlocity (`vlocity_cmt__*`, `vlocity_ins__*`). Para esos, usá [vlocity_build](https://github.com/vlocityinc/vlocity_build).
- Los componentes se importan como **registros nuevos** (INSERT), no upsert. Usá `--force` para reemplazar existentes.
- LWCs custom, clases Apex y campos custom referenciados por los componentes **no** se incluyen — deployealos por separado via metadata API.
- Los componentes importados quedan **inactivos** — necesitás activarlos manualmente o con un script post-deploy.

## Contribuir

¡Las contribuciones son bienvenidas! Abrí issues o mandá pull requests.

## Apoyá Este Proyecto

Si esta herramienta te ahorró tiempo y dolores de cabeza, considerá invitarme un café:

[![Donar con PayPal](https://img.shields.io/badge/Donar-PayPal-blue.svg?style=for-the-badge&logo=paypal)](https://paypal.me/nahuelscarpelli)

---

## License

MIT © Nahuel Scarpelli
