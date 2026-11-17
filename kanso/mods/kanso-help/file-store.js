// One SQLite file under the app's folder: the stores of arrangements and of the dōjō both keep theirs so.
// Herdr loads a mod's files from its own folder only, so this file is copied byte for byte into each mod that keeps a store.
import { Database } from "./platform-database.js";
import { paths } from "./platform-paths.js";
import { appHome } from "herdr";

// A subclass says where its file lives with storeFile(); both words are read on construction.
export class FileStore extends Database {
  constructor(timer) {
    super(timer);
    const [folder, name] = this.storeFile();
    this.dir = paths.join(appHome(), folder);
    this.file = paths.join(this.dir, name);
  }
}
