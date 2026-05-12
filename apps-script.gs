// ═══════════════════════════════════════════════════════
// שים כאן את ה-ID של התיקייה הראשית (תיקיית הרבנים)
// מצא אותו מה-URL של התיקייה בדרייב:
//   drive.google.com/drive/folders/FOLDER_ID_HERE
const ROOT_FOLDER_ID = 'הכנס כאן את ה-ID של התיקייה הראשית';
// ═══════════════════════════════════════════════════════

const AUDIO_EXTS = ['mp3', 'm4a', 'wav', 'ogg', 'aac', 'mp4', 'mpeg', 'flac'];

// ─── נקודת כניסה ─────────────────────────────────────────────────────────────
function doGet() {
  try {
    var root   = DriveApp.getFolderById(ROOT_FOLDER_ID);
    var result = [];

    var rabbiIt = root.getFolders();
    while (rabbiIt.hasNext()) {
      var rabbiFolder = rabbiIt.next();
      var seriesList  = [];

      // קבצים ישירים תחת תיקיית הרב → סדרה "כללי"
      var directFiles = getAudioFiles(rabbiFolder);
      if (directFiles.length > 0) {
        seriesList.push({ id: rabbiFolder.getId() + '_root', name: 'כללי', files: directFiles });
      }

      // רקורסיה לכל תת-תיקיות בכל עומק
      // כל תיקייה שמכילה קבצי אודיו → סדרה בשמה שלה
      var subIt = rabbiFolder.getFolders();
      while (subIt.hasNext()) {
        collectSeries(subIt.next(), seriesList);
      }

      if (seriesList.length > 0) {
        result.push({ id: rabbiFolder.getId(), name: rabbiFolder.getName(), series: seriesList });
      }
    }

    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (e) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: e.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ─── רקורסיה: כל תיקייה שיש בה קבצי אודיו → סדרה בשמה ──────────────────────
function collectSeries(folder, seriesList) {
  var files = getAudioFiles(folder);
  if (files.length > 0) {
    seriesList.push({
      id:    folder.getId(),
      name:  folder.getName(),   // שם התיקייה בלבד, לא נתיב מלא
      files: files
    });
  }
  // המשך לתת-תיקיות בכל עומק
  var subIt = folder.getFolders();
  while (subIt.hasNext()) {
    collectSeries(subIt.next(), seriesList);
  }
}

// ─── שליפת קבצי אודיו מתיקייה (ישירים בלבד, ללא ירידה) ───────────────────────
function getAudioFiles(folder) {
  var pdfs = {};
  try {
    var pdfIt = folder.getFilesByType('application/pdf');
    while (pdfIt.hasNext()) {
      var p   = pdfIt.next();
      var key = p.getName().replace(/\.[^.]+$/, '').trim().toLowerCase();
      pdfs[key] = p.getId();
    }
  } catch (_) {}

  var files  = [];
  var fileIt = folder.getFiles();
  while (fileIt.hasNext()) {
    var f   = fileIt.next();
    var nm  = f.getName();
    var dot = nm.lastIndexOf('.');
    if (dot < 0) continue;
    var ext = nm.substring(dot + 1).toLowerCase();
    if (AUDIO_EXTS.indexOf(ext) < 0) continue;

    var entry = {
      id:   f.getId(),
      name: nm,
      date: Utilities.formatDate(f.getDateCreated(), 'Asia/Jerusalem', 'dd/MM/yyyy')
    };
    var key = nm.substring(0, dot).trim().toLowerCase();
    if (pdfs[key]) entry.sourceId = pdfs[key];
    files.push(entry);
  }

  files.sort(function(a, b) { return a.name.localeCompare(b.name, 'he'); });
  return files;
}

// ─── שיתוף כל הקבצים — הרץ פעם אחת ידנית ────────────────────────────────────
function shareAllFast() {
  shareFolderRecursive(DriveApp.getFolderById(ROOT_FOLDER_ID));
  Logger.log('שיתוף הושלם!');
}

function shareFolderRecursive(folder) {
  var ids    = [];
  var fileIt = folder.getFiles();
  while (fileIt.hasNext()) ids.push(fileIt.next().getId());

  for (var i = 0; i < ids.length; i += 20) {
    var chunk    = ids.slice(i, i + 20);
    var requests = chunk.map(function(id) {
      return {
        url:         'https://www.googleapis.com/drive/v3/files/' + id + '/permissions',
        method:      'post',
        contentType: 'application/json',
        headers:     { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
        payload:     JSON.stringify({ role: 'reader', type: 'anyone' }),
        muteHttpExceptions: true
      };
    });
    UrlFetchApp.fetchAll(requests);
  }
  var subIt = folder.getFolders();
  while (subIt.hasNext()) shareFolderRecursive(subIt.next());
}
