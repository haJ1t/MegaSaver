import { defineCommand } from "citty";
import { packInfoCommand } from "./info.js";
import { packInstallCommand } from "./install.js";
import { packListCommand } from "./list.js";
import { packRemoveCommand } from "./remove.js";

export const packCommand = defineCommand({
  meta: { name: "pack", description: "Manage skill packs." },
  subCommands: {
    install: packInstallCommand,
    list: packListCommand,
    remove: packRemoveCommand,
    info: packInfoCommand,
  },
});

export { runPackInstall } from "./install.js";
export { runPackList } from "./list.js";
export { runPackRemove } from "./remove.js";
export { runPackInfo } from "./info.js";
