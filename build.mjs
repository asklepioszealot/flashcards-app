import fs from "fs";

if (fs.existsSync("dist")) {
  fs.rmSync("dist", { recursive: true, force: true });
}

fs.mkdirSync("dist");
fs.copyFileSync("index.html", "dist/index.html");

if (fs.existsSync("src")) {
  fs.cpSync("src", "dist/src", { recursive: true });
}

if (fs.existsSync("data")) {
  fs.cpSync("data", "dist/data", { recursive: true });
}

console.log("Build complete.");
