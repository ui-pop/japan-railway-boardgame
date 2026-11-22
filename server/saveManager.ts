import fs from 'fs';
import path from 'path';
import { LocalRuleDef, SavedGameSnapshot } from './types';

export class SaveManager {
  private savesDir: string;

  constructor(savesDir: string) {
    this.savesDir = savesDir;
    if (!fs.existsSync(this.savesDir)) {
      fs.mkdirSync(this.savesDir, { recursive: true });
    }
  }

  private sanitizeFilename(name: string): string {
    const cleaned = name.replace(/[^a-zA-Z0-9_\-\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/g, '_');
    return cleaned || 'manual_save';
  }

  public saveAutosave(snapshot: SavedGameSnapshot): void {
    const filePath = path.join(this.savesDir, 'autosave.json');
    fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2), 'utf-8');
  }

  public saveNamed(snapshot: SavedGameSnapshot, label: string): string {
    const safeName = this.sanitizeFilename(label);
    const fileName = `${safeName}.json`;
    const filePath = path.join(this.savesDir, fileName);
    const data: SavedGameSnapshot = {
      ...snapshot,
      label,
      savedAt: new Date().toISOString(),
    };
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    return fileName;
  }

  public loadSave(fileName: string): SavedGameSnapshot | null {
    const base = path.basename(fileName);
    const filePath = path.join(this.savesDir, base);
    if (!fs.existsSync(filePath)) return null;
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(raw) as SavedGameSnapshot;
    } catch (err) {
      console.error('Failed to load save file:', base, err);
      return null;
    }
  }

  public listSaves(): { fileName: string; label: string; savedAt: string; year: number; month: number }[] {
    if (!fs.existsSync(this.savesDir)) return [];
    const files = fs.readdirSync(this.savesDir).filter((f) => f.endsWith('.json'));
    const results: { fileName: string; label: string; savedAt: string; year: number; month: number }[] = [];

    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(this.savesDir, file), 'utf-8');
        const parsed = JSON.parse(raw) as SavedGameSnapshot;
        results.push({
          fileName: file,
          label: parsed.label || (file === 'autosave.json' ? 'オートセーブ' : file.replace('.json', '')),
          savedAt: parsed.savedAt,
          year: parsed.currentYear,
          month: parsed.currentMonth,
        });
      } catch {
        // ignore corrupted file
      }
    }

    return results.sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());
  }

  public saveLocalRules(rules: LocalRuleDef[]): void {
    const filePath = path.join(this.savesDir, 'local_rules.json');
    fs.writeFileSync(filePath, JSON.stringify(rules, null, 2), 'utf-8');
  }

  public loadLocalRules(): LocalRuleDef[] {
    const filePath = path.join(this.savesDir, 'local_rules.json');
    if (!fs.existsSync(filePath)) return [];
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as LocalRuleDef[];
    } catch {
      return [];
    }
  }
}
