// ═══════════════════════════════════════════════════════
// שים כאן את ה-ID של התיקייה הראשית (תיקיית הרבנים)
// מצא אותו מה-URL של התיקייה בדרייב:
//   drive.google.com/drive/folders/FOLDER_ID_HERE
const ROOT_FOLDER_ID = 'הכנס כאן את ה-ID של התיקייה הראשית';
// ═══════════════════════════════════════════════════════

const AUDIO_EXTS = ['mp3', 'm4a', 'wav', 'ogg', 'aac'];

function doGet() {
  const result = [];
  const rootFolder = DriveApp.getFolderById(ROOT_FOLDER_ID);
  const rabbiIt = rootFolder.getFolders();

  while (rabbiIt.hasNext()) {
    const rabbiFolder = rabbiIt.next();
    const rabbi = {
      id: rabbiFolder.getId(),
      name: rabbiFolder.getName(),
      series: []
    };

    const seriesIt = rabbiFolder.getFolders();
    while (seriesIt.hasNext()) {
      const seriesFolder = seriesIt.next();
      const series = {
        id: seriesFolder.getId(),
        name: seriesFolder.getName(),
        files: []
      };

      // איסוף כל הקבצים בתיקיית הסדרה
      const byBase = {}; // שם ללא סיומת → { mp3, pdf }
      const fileIt = seriesFolder.getFiles();

      while (fileIt.hasNext()) {
        const file = fileIt.next();
        const fullName = file.getName();
        const lastDot  = fullName.lastIndexOf('.');
        if (lastDot < 0) continue;
        const ext  = fullName.substring(lastDot + 1).toLowerCase();
        const base = fullName.substring(0, lastDot);

        if (!byBase[base]) byBase[base] = {};

        if (AUDIO_EXTS.includes(ext)) {
          byBase[base].audio = {
            id:   file.getId(),
            name: fullName,
            date: Utilities.formatDate(
              file.getDateCreated(), 'Asia/Jerusalem', 'dd/MM/yyyy'
            )
          };
        } else if (ext === 'pdf') {
          byBase[base].pdfId = file.getId();
        }
      }

      // בניית רשימת הקבצים — רק שיעורים שיש להם קובץ אודיו
      for (const base in byBase) {
        const entry = byBase[base];
        if (!entry.audio) continue;
        const fileObj = {
          id:   entry.audio.id,
          name: entry.audio.name,
          date: entry.audio.date
        };
        if (entry.pdfId) fileObj.sourceId = entry.pdfId;
        series.files.push(fileObj);
      }

      series.files.sort((a, b) => a.name.localeCompare(b.name, 'he'));
      rabbi.series.push(series);
    }

    rabbi.series.sort((a, b) => a.name.localeCompare(b.name, 'he'));
    result.push(rabbi);
  }

  result.sort((a, b) => a.name.localeCompare(b.name, 'he'));

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}
