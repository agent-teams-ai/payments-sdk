import { existsSync, lstatSync, realpathSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

const packages = new URL("../packages/", import.meta.url);

/** Native source tests follow the maintained .js import spelling to its local TypeScript source. */
export function sourceTestTarget(specifier: string, parentURL?: string): URL | undefined {
  if (parentURL === undefined || !specifier.startsWith(".")) {
    return;
  }
  const target = new URL(specifier, parentURL);
  if (!target.href.startsWith(packages.href) || !target.pathname.endsWith(".js")) {
    return;
  }
  const path = target.pathname.slice(packages.pathname.length).split("/");
  if (path[1] !== "src") {
    return;
  }
  target.pathname = `${target.pathname.slice(0, -3)}.ts`;
  const sourcePath = fileURLToPath(target);
  if (
    !existsSync(sourcePath) ||
    !lstatSync(sourcePath).isFile() ||
    realpathSync(sourcePath) !== sourcePath
  ) {
    return;
  }
  return target;
}

registerHooks({
  resolve: (specifier, context, nextResolve) => {
    const target = sourceTestTarget(specifier, context.parentURL);
    return nextResolve(target?.href ?? specifier, context);
  },
});
