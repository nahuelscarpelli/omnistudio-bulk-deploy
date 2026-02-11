🚀 OmniStudio Bulk Deployer (Revenue Cloud)
A lightweight Node.js utility designed to automate the mass migration of OmniStudio components (Standard Objects) between Salesforce environments using the sf data tree / sfdx force:data:tree commands.

This tool simplifies the deployment process by enforcing the correct hierarchical order to prevent dependency errors: DataMappers (DM) → Integration Procedures (IP) → OmniScripts (OS) → FlexCards (FC).

🛠️ Prerequisites
Salesforce CLI: Ensure sf or sfdx is installed.

Authentication: Source and Target orgs must be authorized in your CLI.

Node.js: Version 14 or higher.

📂 Project Configuration
The logic is driven by the deploy-config.json file. You define your environments and the list of components to migrate here.

deploy-config.json Example:
JSON
{
    "sourceOrg": "DEV_ORG_ALIAS",
    "targetOrgs": ["QA_ORG_ALIAS", "UAT_ORG_ALIAS"],
    "baseDir": "./omnistudio-assets",
    "components": [
        { "name": "PrefixGetAccountData", "type": "DM" },
        { "name": "PrefixProcessLead", "type": "IP", "id": "0jNdx000000XXXXEAA" },
        { "name": "PrefixCreateOpportunity", "type": "OS" }
    ]
}
Note: You can omit the id field. The script includes a discovery feature to find IDs by name in the source organization.

🚀 Quick Start Guide
1. Component Management
List your configuration or automatically find missing IDs in your source org:

Bash
# List all configured components
node omnistudio-bulk.js list

# Discover IDs in the Source Org and update the JSON automatically
node omnistudio-bulk.js discover --org "MY_DEV_ORG"
2. Export (Retrieve)
Extract metadata files from the source organization to your local directory:

Bash
# Export EVERYTHING defined in the JSON
node omnistudio-bulk.js export

# Export only specific types
node omnistudio-bulk.js export --only DM,IP

# Export using a name filter (Regex)
node omnistudio-bulk.js export --filter "LeadManagement"
3. Import (Deploy)
Upload local files to target organizations while respecting dependency order:

Bash
# Import to all targetOrgs defined in the config
node omnistudio-bulk.js import

# Import to a specific org (override)
node omnistudio-bulk.js import --org "MY_QA_ORG"
4. Full Migration
Perform Export + Import in a single command:

Bash
node omnistudio-bulk.js migrate --org "MY_UAT_ORG"
💡 Key Benefits
Speed: DataMappers are processed in Batches, significantly reducing execution time compared to individual record processing.

Version Control Ready: The generated JSON tree files are Git-friendly, perfect for a simplified CI/CD workflow.

Guaranteed Order: Eliminates "DataMapper not found" errors by ensuring foundation components are deployed first.

☕ Support / Donate
If this tool helped you save time on your deployments, feel free to buy me a coffee!

PayPal: nahuelscarpelli@gmail.com

📝 Maintenance Notes
To add new components, simply append them to the components list in deploy-config.json.

Ensure components are Active in the source organization for the discover command to locate them.
