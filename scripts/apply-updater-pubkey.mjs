import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const tauriConfPath = path.join(rootDir, "src-tauri", "tauri.conf.json");
const pubkeyFile = path.join(rootDir, "src-tauri", "falafel.key.pub");
const privkeyFile = path.join(rootDir, "src-tauri", "falafel.key");

if (!fs.existsSync(pubkeyFile)) {
  console.error(`\n[ERROR] Public key file not found: ${pubkeyFile}`);
  console.error("Please ensure key generation completed successfully.\n");
  process.exit(1);
}

const pubkeyRaw = fs.readFileSync(pubkeyFile, "utf8").trim();
// Tauri's .pub file can already be base64-encoded ("untrusted comment..." base64 string)
const base64Pubkey = pubkeyRaw.startsWith("dW50cnVzdGVk")
  ? pubkeyRaw
  : Buffer.from(pubkeyRaw + "\n", "utf8").toString("base64");

const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, "utf8"));
if (!tauriConf.plugins) tauriConf.plugins = {};
if (!tauriConf.plugins.updater) tauriConf.plugins.updater = {};
tauriConf.plugins.updater.pubkey = base64Pubkey;

fs.writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + "\n", "utf8");

console.log("\n======================================================================");
console.log(" [SUCCESS] Public key successfully updated in src-tauri/tauri.conf.json!");
console.log("======================================================================\n");
console.log(`New pubkey: ${base64Pubkey}\n`);

if (fs.existsSync(privkeyFile)) {
  const privkeyContent = fs.readFileSync(privkeyFile, "utf8").trim();
  console.log("----------------------------------------------------------------------");
  console.log("NEXT STEPS - Configure GitHub Actions Secrets:");
  console.log("Open: https://github.com/Falafel0/FalafelUI/settings/secrets/actions");
  console.log("Add the following repository secrets:\n");
  console.log("1. TAURI_SIGNING_PRIVATE_KEY");
  console.log("   Value:\n");
  console.log(privkeyContent);
  console.log("\n2. TAURI_SIGNING_PRIVATE_KEY_PASSWORD");
  console.log("   Value: [The password you entered when prompted, or leave empty if none]");
  console.log("----------------------------------------------------------------------\n");
}
