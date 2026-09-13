import fs from "node:fs";
import path from "node:path";
import { TetherRequest, Contact } from "./domain.js";

/**
 * Minimal JSON-file store. One file per collection. Good enough for a single
 * family backend running on one machine; swap for SQLite later.
 */
export class Store {
  constructor(private readonly dir: string) {
    fs.mkdirSync(dir, { recursive: true });
  }

  private file(name: string) {
    return path.join(this.dir, `${name}.json`);
  }

  private readAll<T>(name: string): T[] {
    const f = this.file(name);
    if (!fs.existsSync(f)) return [];
    return JSON.parse(fs.readFileSync(f, "utf8")) as T[];
  }

  private writeAll<T>(name: string, rows: T[]) {
    const f = this.file(name);
    const tmp = `${f}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(rows, null, 2));
    fs.renameSync(tmp, f);
  }

  listRequests(filter?: { familyId?: string; memberId?: string }): TetherRequest[] {
    return this.readAll<TetherRequest>("requests").filter(
      (r) =>
        (!filter?.familyId || r.familyId === filter.familyId) &&
        (!filter?.memberId || r.memberId === filter.memberId),
    );
  }

  getRequest(id: string): TetherRequest | undefined {
    return this.readAll<TetherRequest>("requests").find((r) => r.id === id);
  }

  saveRequest(req: TetherRequest) {
    const rows = this.readAll<TetherRequest>("requests");
    const i = rows.findIndex((r) => r.id === req.id);
    req.updatedAt = new Date().toISOString();
    if (i >= 0) rows[i] = req;
    else rows.push(req);
    this.writeAll("requests", rows);
    return req;
  }

  listContacts(): Contact[] {
    return this.readAll<Contact>("contacts").map((c) => Contact.parse(c));
  }

  getContact(id: string): Contact | undefined {
    return this.listContacts().find((c) => c.id === id);
  }

  saveContacts(contacts: Contact[]) {
    this.writeAll("contacts", contacts.map((c) => Contact.parse(c)));
  }
}
