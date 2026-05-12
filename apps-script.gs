// ═══════════════════════════════════════════════════════
// שים כאן את ה-ID של התיקייה הראשית (תיקיית הרבנים)
// מצא אותו מה-URL של התיקייה בדרייב:
//   drive.google.com/drive/folders/FOLDER_ID_HERE
const ROOT_FOLDER_ID = 'הכנס כאן את ה-ID של התיקייה הראשית';
// ═══════════════════════════════════════════════════════

const AUDIO_EXTS = ['mp3', 'm4a', 'wav', 'ogg', 'aac', 'mp4', 'mpeg'];

// ─── נקודת כניסה ─────────────────────────────────────────────────────────────
function doGet() {
  try {
    const root = DriveApp.getFolderById(ROOT_FOLDER_ID);
    const result = [];

    const rabbiIt = root.getFolders();
    while (rabbiIt.hasNext()) {
      const rabbiFolder = rabbiIt.next();
      const allSeries = [];

      // כל תיקייה ישירה תחת הרב → אסוף ממנה סדרות (רקורסיבי)
      const seriesIt = rabbiFolder.getFolders();
      while (seriesIt.hasNext()) {
        const collected = collectSeries(seriesIt.next());
        allSeries.push.apply(allSeries, collected);
      }

      // גם קבצים ישירים תחת תיקיית הרב (מקרה קצה)
      const directFiles = getAudioFiles(rabbiFolder);
      if (directFiles.length > 0) {
        allSeries.unshift({ id: rabbiFolder.getId() + '_d', name: 'כללי', files: directFiles });
      }

      if (allSeries.length > 0) {
        allSeries.sort((a, b) => a.name.localeCompare(b.name, 'he'));
        result.push({ id: rabbiFolder.getId(), name: rabbiFolder.getName(), series: allSeries });
      }
    }

    result.sort((a, b) => a.name.localeCompare(b.name, 'he'));

    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (e) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: e.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ─── איסוף סדרות רקורסיבי ────────────────────────────────────────────────────
// מחזיר מערך של { id, name, files } לכל "שכבה" שמכילה קבצי אודיו
// עובד על כל עומק: תיקייה/תיקייה/תיקייה/.../קבצים
function collectSeries(folder) {
  const result = [];

  // האם יש קבצי אודיו ישירים בתיקייה זו?
  const audioFiles = getAudioFiles(folder);
  if (audioFiles.length > 0) {
    result.push({ id: folder.getId(), name: folder.getName(), files: audioFiles });
  }

  // ירידה לתיקיות פנימיות (עומק כלשהו)
  const subIt = folder.getFolders();
  while (subIt.hasNext()) {
    const sub = subIt.next();
    const subResult = collectSeries(sub);
    subResult.forEach(function(s) { result.push(s); });
  }

  return result;
}

// ─── שליפת קבצי אודיו מתיקייה (ללא כניסה לתת-תיקיות) ───────────────────────
function getAudioFiles(folder) {
  // קודם אוספים PDF-ים לצורך התאמה למקורות
  const pdfs = {};
  try {
    const pdfIt = folder.getFilesByType('application/pdf');
    while (pdfIt.hasNext()) {
      const p = pdfIt.next();
      const key = p.getName().replace(/\.[^.]+$/, '').trim().toLowerCase();
      pdfs[key] = p.getId();
    }
  } catch (_) {}

  const files = [];
  const fileIt = folder.getFiles();
  while (fileIt.hasNext()) {
    const f = fileIt.next();
    const name = f.getName();
    const lastDot = name.lastIndexOf('.');
    if (lastDot < 0) continue;
    const ext = name.substring(lastDot + 1).toLowerCase();
    if (AUDIO_EXTS.indexOf(ext) < 0) continue;

    const entry = {
      id:   f.getId(),
      name: name,
      date: Utilities.formatDate(f.getDateCreated(), 'Asia/Jerusalem', 'dd/MM/yyyy')
    };

    const key = name.substring(0, lastDot).trim().toLowerCase();
    if (pdfs[key]) entry.sourceId = pdfs[key];

    files.push(entry);
  }

  files.sort(function(a, b) { return a.name.localeCompare(b.name, 'he'); });
  return files;
}

// ─── שיתוף כל הקבצים (הרץ פעם אחת ידנית) ────────────────────────────────────
function shareAllFast() {
  shareFolderRecursive(DriveApp.getFolderById(ROOT_FOLDER_ID));
  Logger.log('שיתוף הושלם!');
}

function shareFolderRecursive(folder) {
  // איסוף כל ה-ID-ים בתיקייה
  const ids = [];
  const fileIt = folder.getFiles();
  while (fileIt.hasNext()) ids.push(fileIt.next().getId());

  // שיתוף ב-20 בכל קריאה
  for (var i = 0; i < ids.length; i += 20) {
    var chunk = ids.slice(i, i + 20);
    var requests = chunk.map(function(id) {
      return {
        url: 'https://www.googleapis.com/drive/v3/files/' + id + '/permissions',
        method: 'post',
        contentType: 'application/json',
        headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
        payload: JSON.stringify({ role: 'reader', type: 'anyone' }),
        muteHttpExceptions: true
      };
    });
    UrlFetchApp.fetchAll(requests);
  }

  // רקורסיה לתת-תיקיות
  var subIt = folder.getFolders();
  while (subIt.hasNext()) shareFolderRecursive(subIt.next());
}
