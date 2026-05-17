const ROOT_FOLDER_ID = '1zw4VesyECCS-FQE0IPN_4bd_uLkdq3ms';

const AUDIO_MIMES = ['audio/mpeg','audio/mp4','audio/x-m4a','audio/wav','audio/ogg','audio/aac','audio/flac'];

// ─── נקודת כניסה ──────────────────────────────────────────────────────────────
function doGet(e) {
  if (e && e.parameter && e.parameter.action === 'share') {
    try {
      shareFolderRecursive(DriveApp.getFolderById(ROOT_FOLDER_ID));
      return ok('שיתוף הושלם');
    } catch(err) { return err_(err.message); }
  }

  try {
    var token = ScriptApp.getOAuthToken();

    // שלב 1: קבל את כל התיקיות בעץ (BFS — רמה אחר רמה)
    var allFolders = getAllFolders(token);

    // שלב 2: קבל את כל קבצי האודיו בשאילתות מקובצות
    var allFolderIds = [ROOT_FOLDER_ID].concat(allFolders.map(function(f){ return f.id; }));
    var allFiles = getAllAudioFiles(allFolderIds, token);

    // שלב 3: בנה עץ בזיכרון
    var tree = buildTree(allFolders, allFiles);

    // החזר רק תיקיות ברמת הרב (ילדים ישירים של root)
    var result = tree.folders.sort(function(a,b){ return a.name.localeCompare(b.name,'he'); });

    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);

  } catch(e) { return err_(e.message); }
}

// ─── BFS: קבל את כל התיקיות ברמות שונות (בקבוצות קטנות) ────────────────────
function getAllFolders(token) {
  var allFolders = [];
  var currentLevel = [ROOT_FOLDER_ID];
  var BATCH = 20; // קטן כדי לא לחרוג ממגבלת URL

  while (currentLevel.length > 0) {
    var nextLevel = [];
    for (var i = 0; i < currentLevel.length; i += BATCH) {
      var batch   = currentLevel.slice(i, i + BATCH);
      var parentQ = batch.map(function(id){ return "'" + id + "' in parents"; }).join(' or ');
      var query   = "(" + parentQ + ") and mimeType='application/vnd.google-apps.folder' and trashed=false";
      var found   = apiQuery(query, 'nextPageToken,files(id,name,parents)', token);
      allFolders  = allFolders.concat(found);
      nextLevel   = nextLevel.concat(found.map(function(f){ return f.id; }));
    }
    currentLevel = nextLevel;
  }

  return allFolders;
}

// ─── קבל קבצי אודיו בשאילתות מקובצות (50 תיקיות בכל פעם) ────────────────────
function getAllAudioFiles(folderIds, token) {
  var mimeQ    = AUDIO_MIMES.map(function(m){ return "mimeType='" + m + "'"; }).join(' or ');
  var allFiles = [];
  var BATCH    = 20;

  for (var i = 0; i < folderIds.length; i += BATCH) {
    var batch   = folderIds.slice(i, i + BATCH);
    var parentQ = batch.map(function(id){ return "'" + id + "' in parents"; }).join(' or ');
    var query   = "(" + parentQ + ") and (" + mimeQ + ") and trashed=false";
    var files   = apiQuery(query, 'nextPageToken,files(id,name,parents,createdTime)', token);
    allFiles    = allFiles.concat(files);
  }

  return allFiles;
}

// ─── בנה עץ בזיכרון ───────────────────────────────────────────────────────────
function buildTree(allFolders, allFiles) {
  // צור מפה של תיקיות
  var map = {};
  map[ROOT_FOLDER_ID] = { id: ROOT_FOLDER_ID, name: 'root', folders: [], files: [] };
  allFolders.forEach(function(f) {
    map[f.id] = { id: f.id, name: f.name, folders: [], files: [] };
  });

  // חבר תיקיות להורים
  allFolders.forEach(function(f) {
    var pid = f.parents && f.parents[0];
    if (pid && map[pid]) map[pid].folders.push(map[f.id]);
  });

  // חבר קבצים לתיקיות
  allFiles.forEach(function(f) {
    var pid = f.parents && f.parents[0];
    if (pid && map[pid]) {
      map[pid].files.push({
        id:   f.id,
        name: f.name,
        date: f.createdTime
          ? f.createdTime.substring(8,10)+'/'+f.createdTime.substring(5,7)+'/'+f.createdTime.substring(0,4)
          : ''
      });
    }
  });

  // מיון + פינוי ענפים ריקים
  function pruneAndSort(node) {
    node.files.sort(function(a,b){ return a.name.localeCompare(b.name,'he'); });
    node.folders = node.folders.filter(function(sub){ return pruneAndSort(sub); });
    node.folders.sort(function(a,b){ return a.name.localeCompare(b.name,'he'); });
    return node.files.length > 0 || node.folders.length > 0;
  }
  pruneAndSort(map[ROOT_FOLDER_ID]);

  return map[ROOT_FOLDER_ID];
}

// ─── Drive API v3 עם pagination ───────────────────────────────────────────────
function apiQuery(query, fields, token) {
  var results   = [];
  var pageToken = null;
  do {
    var url = 'https://www.googleapis.com/drive/v3/files'
      + '?q='       + encodeURIComponent(query)
      + '&fields='  + encodeURIComponent(fields)
      + '&pageSize=1000'
      + (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '');
    var resp = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true
    });
    var data = JSON.parse(resp.getContentText());
    if (data.error) throw new Error('Drive API: ' + JSON.stringify(data.error));
    results   = results.concat(data.files || []);
    pageToken = data.nextPageToken;
  } while (pageToken);
  return results;
}

// ─── שיתוף כל הקבצים ─────────────────────────────────────────────────────────
function shareAllFast() {
  shareFolderRecursive(DriveApp.getFolderById(ROOT_FOLDER_ID));
  Logger.log('שיתוף הושלם!');
}

function shareFolderRecursive(folder) {
  var ids = [];
  var it  = folder.getFiles();
  while (it.hasNext()) ids.push(it.next().getId());

  for (var i = 0; i < ids.length; i += 20) {
    UrlFetchApp.fetchAll(ids.slice(i, i+20).map(function(id) {
      return {
        url: 'https://www.googleapis.com/drive/v3/files/' + id + '/permissions',
        method: 'post', contentType: 'application/json',
        headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
        payload: JSON.stringify({ role: 'reader', type: 'anyone' }),
        muteHttpExceptions: true
      };
    }));
  }
  var subIt = folder.getFolders();
  while (subIt.hasNext()) shareFolderRecursive(subIt.next());
}

// ─── עזרים ────────────────────────────────────────────────────────────────────
function ok(msg)  { return ContentService.createTextOutput(JSON.stringify({ ok: true, msg: msg })).setMimeType(ContentService.MimeType.JSON); }
function err_(msg){ return ContentService.createTextOutput(JSON.stringify({ error: msg })).setMimeType(ContentService.MimeType.JSON); }
