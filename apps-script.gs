// ═══════════════════════════════════════════════════════
// שים כאן את ה-ID של התיקייה הראשית (תיקיית הרבנים)
// מצא אותו מה-URL של התיקייה בדרייב:
//   drive.google.com/drive/folders/FOLDER_ID_HERE
const ROOT_FOLDER_ID = 'הכנס כאן את ה-ID של התיקייה הראשית';
// ═══════════════════════════════════════════════════════

const AUDIO_EXTS = ['mp3', 'm4a', 'wav', 'ogg', 'aac', 'mp4', 'mpeg', 'flac'];

// ─── נקודת כניסה ─────────────────────────────────────────────────────────────
function doGet(e) {
  // action=share — שיתוף כל הקבצים
  if (e && e.parameter && e.parameter.action === 'share') {
    try {
      shareFolderRecursive(DriveApp.getFolderById(ROOT_FOLDER_ID));
      return ContentService
        .createTextOutput(JSON.stringify({ ok: true, msg: 'שיתוף הושלם' }))
        .setMimeType(ContentService.MimeType.JSON);
    } catch(err) {
      return ContentService
        .createTextOutput(JSON.stringify({ error: err.message }))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }

  try {
    var root   = DriveApp.getFolderById(ROOT_FOLDER_ID);
    var result = [];

    var rabbiIt = root.getFolders();
    while (rabbiIt.hasNext()) {
      var node = buildTree(rabbiIt.next());
      if (node) result.push(node);
    }

    // מיון רבנים לפי שם
    result.sort(function(a, b) { return a.name.localeCompare(b.name, 'he'); });

    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (e) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: e.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ─── בניית עץ תיקיות רקורסיבי — שומר על המבנה המלא כמו ב-Drive ────────────────
function buildTree(folder) {
  var files     = getAudioFiles(folder);
  var subFolders = [];

  var subIt = folder.getFolders();
  while (subIt.hasNext()) {
    var child = buildTree(subIt.next());
    if (child) subFolders.push(child);
  }

  // החזר null אם אין קבצים בכלל (כולל עומק)
  if (files.length === 0 && subFolders.length === 0) return null;

  // מיון תת-תיקיות לפי שם
  subFolders.sort(function(a, b) { return a.name.localeCompare(b.name, 'he'); });

  return {
    id:      folder.getId(),
    name:    folder.getName(),
    files:   files,
    folders: subFolders
  };
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
