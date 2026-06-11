import { defineCommand } from "citty";
import { indexBuildCommand } from "./build.js";
import { indexSearchCommand } from "./search.js";
import { indexShowCommand } from "./show.js";
import { indexStatusCommand } from "./status.js";

export { type RunIndexBuildInput, runIndexBuild, indexBuildCommand } from "./build.js";
export { type RunIndexStatusInput, runIndexStatus, indexStatusCommand } from "./status.js";
export { type RunIndexSearchInput, runIndexSearch, indexSearchCommand } from "./search.js";
export { type RunIndexShowInput, runIndexShow, indexShowCommand } from "./show.js";

export const indexCommand = defineCommand({
  meta: { name: "index", description: "Build and query the semantic code index." },
  subCommands: {
    build: indexBuildCommand,
    status: indexStatusCommand,
    search: indexSearchCommand,
    show: indexShowCommand,
  },
});
