function fixBrandContextInSheet() {
  const ss = SpreadsheetApp.openById(
    PropertiesService.getScriptProperties().getProperty("DB_SHEET_ID")
  );
  const sheet = ss.getSheetByName("Settings");
  const data = sheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    const key = data[i][0];
    let val = data[i][1];
    
    // Nur bei den Brand Context Keys anwenden
    if (key && key.startsWith("brandContext")) {
      // Falls der Wert noch kein Apostroph hat, f?gen wir ihn hinzu
      // (Nutzt die escapeSheetValue_ Funktion aus deinem bestehenden Code)
      let escapedVal = escapeSheetValue_(String(val));
      sheet.getRange(i + 1, 2).setValue(escapedVal);
    }
  }
  Logger.log("Fertig ? Brand Context Zeilen repariert.");
}