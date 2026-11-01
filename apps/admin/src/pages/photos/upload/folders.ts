import { classifyUploadFile, compareFileNames, type UploadFileClass } from '@dr/shared';

// 落としたフォルダ・ファイルを、アルバムごとのまとまりにする(PF-2)。
// - いちばん上のフォルダ1つ = アルバム1つ(フォルダの名前でアルバムを決める)。中のフォルダの写真も、同じアルバムに入れる
// - フォルダに入っていないファイルは folder = null(アルバムの上に落としたときは、そのアルバムに入れる)
// - JPEG と HEIC だけを送る。ほかのファイル(RAW・動画・隠しファイルなど)は飛ばして数える

export type PickedFile = { file: File; kind: Extract<UploadFileClass, 'jpeg' | 'heic'> };
export type FolderGroup = { folder: string | null; files: PickedFile[]; skipped: number };

type Entry = FileSystemEntry;

function readAll(dir: FileSystemDirectoryEntry): Promise<Entry[]> {
  const reader = dir.createReader();
  const out: Entry[] = [];
  return new Promise((resolve, reject) => {
    // readEntries は 100件ずつしか返さないので、空になるまで読む
    const next = () =>
      reader.readEntries((batch) => {
        if (batch.length === 0) resolve(out);
        else {
          out.push(...batch);
          next();
        }
      }, reject);
    next();
  });
}

const fileOf = (entry: FileSystemFileEntry) => new Promise<File>((resolve, reject) => entry.file(resolve, reject));

async function walk(entry: Entry, files: File[]): Promise<void> {
  if (entry.isFile) files.push(await fileOf(entry as FileSystemFileEntry));
  else if (entry.isDirectory) for (const child of await readAll(entry as FileSystemDirectoryEntry)) await walk(child, files);
}

function group(folder: string | null, files: File[]): FolderGroup {
  const picked: PickedFile[] = [];
  let skipped = 0;
  for (const file of files) {
    const kind = classifyUploadFile(file.name, file.type);
    if (kind === 'jpeg' || kind === 'heic') picked.push({ file, kind });
    else skipped++;
  }
  picked.sort((a, b) => compareFileNames(a.file.name, b.file.name));
  return { folder, files: picked, skipped };
}

/** ドラッグ&ドロップで落としたもの */
export async function groupsFromDrop(dt: DataTransfer): Promise<FolderGroup[]> {
  const entries = [...dt.items]
    .filter((i) => i.kind === 'file')
    .map((i) => i.webkitGetAsEntry?.())
    .filter((e): e is Entry => !!e);
  // フォルダとして読めないブラウザは、ファイルだけ
  if (entries.length === 0) return [group(null, [...dt.files])];
  const groups: FolderGroup[] = [];
  const loose: File[] = [];
  for (const e of entries) {
    if (e.isDirectory) {
      const files: File[] = [];
      await walk(e, files);
      groups.push(group(e.name, files));
    } else loose.push(await fileOf(e as FileSystemFileEntry));
  }
  if (loose.length) groups.push(group(null, loose));
  return groups;
}

/** 「フォルダを選ぶ」(webkitdirectory)・「写真を選ぶ」で選んだもの */
export function groupsFromInput(list: FileList): FolderGroup[] {
  const byFolder = new Map<string | null, File[]>();
  for (const f of list) {
    const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath ?? '';
    const folder = rel.includes('/') ? rel.split('/')[0]! : null;
    const arr = byFolder.get(folder) ?? [];
    arr.push(f);
    byFolder.set(folder, arr);
  }
  return [...byFolder.entries()].map(([folder, files]) => group(folder, files));
}
