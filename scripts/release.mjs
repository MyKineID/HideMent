// Build + zip a dev release: hidement-dev-TAHUN-BULAN-TANGGAL-JAM-MENIT.zip
// in releases/. The zip holds the built extension (dist/) and is uploaded
// as the asset of a GitHub Release with the same dev-... tag.
// Time comes from the machine's local clock; set TZ=Asia/Pontianak when
// building from a server whose clock is not WIB.
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pad = (n) => String(n).padStart(2, "0");
const now = new Date();
const stamp = [
  now.getFullYear(),
  pad(now.getMonth() + 1),
  pad(now.getDate()),
  pad(now.getHours()),
  pad(now.getMinutes()),
].join("-");
const tag = `dev-${stamp}`;
const zipName = `hidement-${tag}.zip`;

mkdirSync(join(root, "releases"), { recursive: true });
execSync("npm run build", { cwd: root, stdio: "inherit" });

if (process.platform === "win32") {
  execSync(
    `powershell -NoProfile -Command "Compress-Archive -Path dist\\* -DestinationPath 'releases\\${zipName}' -Force"`,
    { cwd: root, stdio: "inherit" },
  );
} else {
  execSync(`cd dist && zip -qr "../releases/${zipName}" .`, {
    cwd: root,
    stdio: "inherit",
  });
}

console.log(`\nRilis dev siap: releases/${zipName}`);
console.log(`Tag: ${tag}`);
console.log("Lalu buat GitHub Release dengan tag di atas, lalu upload zip ini sebagai asetnya.");
