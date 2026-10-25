import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { auditPackageArchive, packPackages, repository } from "./package-artifacts.ts";

const tarballs = await packPackages();
const report = [];
for (const [name, tarball] of tarballs) {
  const { entries } = await auditPackageArchive(tarball, name);
  report.push({ name, tarball, entries });
}
await mkdir(join(repository, ".artifacts"), { recursive: true });
await writeFile(
  join(repository, ".artifacts/release-dry-run.json"),
  `${JSON.stringify({ published: false, packages: report }, null, 2)}\n`,
);
console.log(JSON.stringify({ published: false, packages: report }, null, 2));
