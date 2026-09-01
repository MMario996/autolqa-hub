// =====================================================================
// AUTOLQA HUB - GOOGLE SHEETS DATABASE & PROFILES (Database.gs)
// =====================================================================

function getDbSheet_() {
  const props = PropertiesService.getScriptProperties();
  let sheetId = props.getProperty("DB_SHEET_ID");
  let ss;
  if (sheetId) {
    try { ss = SpreadsheetApp.openById(sheetId); } catch(e) { sheetId = null; }
  }
  if (!sheetId) {
    ss = SpreadsheetApp.create("AutoLQA Hub - Database");
    props.setProperty("DB_SHEET_ID", ss.getId());

    const tabs = ["Settings", "Profiles", "Reports", "Issues", "Audit Log", "Run History"];
    tabs.forEach(t => { if(!ss.getSheetByName(t)) ss.insertSheet(t); });

    const sheet1 = ss.getSheetByName("Sheet1") || ss.getSheetByName("Tabellenblatt1");
    if(sheet1) ss.deleteSheet(sheet1);

    ss.getSheetByName("Settings").appendRow(["Key", "Value"]);
    ss.getSheetByName("Profiles").appendRow(["ID", "Name", "JSON Data"]);
    ss.getSheetByName("Reports").appendRow(["ReportID", "Date", "ProjectID", "ProjectName", "Profile", "Score", "Passed", "TotalSegs", "TotalWords", "Errors", "Summary"]);
    ss.getSheetByName("Issues").appendRow(["ReportID", "IssueID", "Category", "Subcategory", "Severity", "Penalty", "Confidence", "Status", "Source", "Target", "Suggestion", "Explanation", "RootCause"]);
    ss.getSheetByName("Audit Log").appendRow(["Timestamp", "Action", "Details"]);
    ss.getSheetByName("Run History").appendRow(["Timestamp", "ReportID", "Model", "Duration_ms", "Passes", "IssuesFound"]);

    tabs.forEach(t => ss.getSheetByName(t).getRange("A1:Z1").setFontWeight("bold"));
    tabs.forEach(t => ss.getSheetByName(t).setFrozenRows(1));

    saveAppSettings_internal(getDefaultSettings_(), ss);
    logAudit_("System", "Database Sheet created.", ss);
  }
  return ss;
}

function logAudit_(action, details, ssObj) {
  try {
    const ss = ssObj || getDbSheet_();
    ss.getSheetByName("Audit Log").appendRow([new Date().toISOString(), action, details]);
  } catch(e) { Logger.log("Audit Error: " + e.message); }
}

function getDatabaseUrl() {
  try { return { success: true, url: getDbSheet_().getUrl() }; }
  catch(e) { return { success: false, error: e.message }; }
}

function recreateDatabase() {
  try {
    PropertiesService.getScriptProperties().deleteProperty("DB_SHEET_ID");
    const ss = getDbSheet_();
    return { success: true, url: ss.getUrl() };
  } catch(e) { return { success: false, error: e.message }; }
}

// =====================================================================
// REPORTS & ISSUES
// =====================================================================

function saveReportToDb_(report, runHistory) {
  try {
    const ss = getDbSheet_();
    ss.getSheetByName("Reports").appendRow([
      report.reportId, report.date, report.projectUid, report.projectName, report.profileName,
      report.score, report.passed, report.totalSegments, report.totalWords || 0, (report.issues||[]).length, report.summary
    ]);
    const isSheet = ss.getSheetByName("Issues");
    (report.issues||[]).forEach(i => {
      isSheet.appendRow([
        report.reportId, i.id, i.category, i.subcategory, i.severity, i.penaltyPoints,
        i.confidence, i.status||'pending', i.source, i.target, i.suggestion, i.explanation, i.rootCause || 'Production'
      ]);
    });
    ss.getSheetByName("Run History").appendRow([
      new Date().toISOString(), report.reportId, runHistory.model, runHistory.duration, runHistory.passes, (report.issues||[]).length
    ]);
    SpreadsheetApp.flush();
  } catch(e) { Logger.log("Error saving report to DB: " + e.message); }
}

/**
 * L?dt alle Reports aus dem Sheet.
 * Gibt immer ein Array zur?ck ? nie null/undefined.
 * Reports werden mit issues verkn?pft und nach Datum sortiert (neueste zuerst).
 */
function getAllReportsFromDb() {
  try {
    const ss = getDbSheet_();
    const repSheet = ss.getSheetByName("Reports");
    const issSheet = ss.getSheetByName("Issues");

    const repData = repSheet.getDataRange().getValues();
    const issData = issSheet.getDataRange().getValues();

    // Reports aufbauen
    const reportsMap = {};
    for (let i = 1; i < repData.length; i++) {
      const r = repData[i];
      if (!r[0]) continue;
      const rid = String(r[0]);
      reportsMap[rid] = {
        reportId: rid,
        date: r[1] ? String(r[1]).substring(0, 10) : '',
        projectUid: String(r[2] || ''),
        projectName: String(r[3] || ''),
        profileName: String(r[4] || ''),
        score: Number(r[5]) || 0,
        passed: r[6] === true || r[6] === 'true' || r[6] === 'TRUE',
        totalSegments: Number(r[7]) || 0,
        totalWords: Number(r[8]) || 0,
        summary: String(r[10] || ''),
        issues: []
      };
    }

    // Issues zuordnen
    for (let i = 1; i < issData.length; i++) {
      const row = issData[i];
      if (!row[0]) continue;
      const rid = String(row[0]);
      if (reportsMap[rid]) {
        reportsMap[rid].issues.push({
          id: String(row[1] || ''),
          category: String(row[2] || ''),
          subcategory: String(row[3] || ''),
          severity: String(row[4] || ''),
          penaltyPoints: Number(row[5]) || 0,
          confidence: Number(row[6]) || 0,
          status: String(row[7] || 'pending'),
          source: String(row[8] || ''),
          target: String(row[9] || ''),
          suggestion: String(row[10] || ''),
          explanation: String(row[11] || ''),
          rootCause: String(row[12] || 'Production')
        });
      }
    }

    // Als Array, neueste zuerst (nach reportId sortiert, da REP-<timestamp>)
    const sorted = Object.values(reportsMap).sort((a, b) => {
      // REP-<timestamp>... ? timestamp vergleichen
      const ta = a.reportId.replace('REP-', '').split('-')[0];
      const tb = b.reportId.replace('REP-', '').split('-')[0];
      return parseInt(tb) - parseInt(ta);
    });

    return { success: true, reports: sorted };
  } catch(e) {
    Logger.log("getAllReportsFromDb Error: " + e.message);
    return { success: false, error: e.message, reports: [] };
  }
}

function updateIssueStatus(reportId, issueId, newStatus) {
  try {
    const ss = getDbSheet_();
    const sheet = ss.getSheetByName("Issues");
    const data = sheet.getDataRange().getValues();
    for(let i=1; i<data.length; i++) {
      if(String(data[i][0]) === String(reportId) && String(data[i][1]) === String(issueId)) {
        sheet.getRange(i+1, 8).setValue(newStatus);
        break;
      }
    }
    SpreadsheetApp.flush();
    return { success: true };
  } catch(e) { return { success: false, error: e.message }; }
}

function bulkUpdateIssuesStatus(reportId, issueIds, newStatus) {
  try {
    const ss = getDbSheet_();
    const sheet = ss.getSheetByName("Issues");
    const data = sheet.getDataRange().getValues();
    let updated = 0;
    for(let i=1; i<data.length; i++) {
      if(String(data[i][0]) === String(reportId) && issueIds.includes(String(data[i][1]))) {
        sheet.getRange(i+1, 8).setValue(newStatus);
        updated++;
      }
    }
    SpreadsheetApp.flush();
    return { success: true, count: updated };
  } catch(e) { return { success: false, error: e.message }; }
}

function deleteReportFromDb(reportId) {
  try {
    const ss = getDbSheet_();
    ["Reports", "Issues", "Run History"].forEach(sheetName => {
      const sheet = ss.getSheetByName(sheetName);
      const data = sheet.getDataRange().getValues();
      for(let i = data.length - 1; i >= 1; i--) {
        let colIdx = sheetName === "Run History" ? 1 : 0;
        if(String(data[i][colIdx]) === String(reportId)) {
          sheet.deleteRow(i + 1);
        }
      }
    });
    SpreadsheetApp.flush();
    logAudit_("Admin", `Report ${reportId} deleted.`);
    return { success: true };
  } catch(e) { return { success: false, error: e.message }; }
}

// =====================================================================
// EXPORT: erstellt einen "LQA Export"-Tab im DB-Sheet mit allen
// Reports und Issues ?bersichtlich formatiert und gibt die URL zur?ck.
// =====================================================================

function exportReportsToSheet() {
  try {
    const ss = getDbSheet_();

    // Alten Export-Tab l?schen falls vorhanden
    const existingExport = ss.getSheetByName("LQA Export");
    if (existingExport) ss.deleteSheet(existingExport);

    const exportSheet = ss.insertSheet("LQA Export");

    // ?? Titel ??
    exportSheet.getRange("A1").setValue("AutoLQA Hub ? Report Export");
    exportSheet.getRange("A1").setFontSize(14).setFontWeight("bold");
    exportSheet.getRange("B1").setValue(new Date().toLocaleString('de-DE'));
    exportSheet.getRange("B1").setFontColor("#666666");

    // ?? Reports-?bersicht ??
    exportSheet.getRange("A3").setValue("REPORTS ?BERSICHT").setFontWeight("bold").setBackground("#333333").setFontColor("#FFED00");
    const repHeaders = ["Report ID", "Datum", "Projekt", "Sprache", "Profil", "Score %", "Bestanden", "Segmente", "W?rter", "Issues", "Zusammenfassung"];
    exportSheet.getRange(4, 1, 1, repHeaders.length).setValues([repHeaders]).setFontWeight("bold").setBackground("#FFED00").setFontColor("#111111");

    const all = getAllReportsFromDb();
    const reports = (all.reports || []).slice().reverse(); // ?lteste zuerst f?r ?bersichtliche Darstellung
    let row = 5;
    reports.forEach(r => {
      const rowData = [
        r.reportId,
        r.date,
        r.projectName,
        r.targetLang || 'all',
        r.profileName,
        r.score,
        r.passed ? 'JA' : 'NEIN',
        r.totalSegments,
        r.totalWords,
        (r.issues || []).length,
        r.summary
      ];
      exportSheet.getRange(row, 1, 1, rowData.length).setValues([rowData]);
      // Farbe nach Bestanden/Nicht bestanden
      exportSheet.getRange(row, 7).setBackground(r.passed ? '#d4edda' : '#f8d7da');
      exportSheet.getRange(row, 6).setFontWeight("bold");
      row++;
    });

    row += 2;

    // ?? Issues-Detail ??
    exportSheet.getRange(row, 1).setValue("ISSUES DETAIL").setFontWeight("bold").setBackground("#333333").setFontColor("#FFED00");
    row++;
    const issHeaders = ["Report ID", "Datum", "Projekt", "Sprache", "Segment ID", "Kategorie", "Subkategorie", "Severity", "Penalty", "Konfidenz", "Status", "Root Cause", "Source", "Target", "Erkl?rung", "Vorschlag"];
    exportSheet.getRange(row, 1, 1, issHeaders.length).setValues([issHeaders]).setFontWeight("bold").setBackground("#FFED00").setFontColor("#111111");
    row++;

    const severityColors = { critical: '#f8d7da', major: '#fff3cd', minor: '#cce5ff', neutral: '#f8f9fa' };

    reports.forEach(r => {
      (r.issues || []).forEach(iss => {
        const issRow = [
          r.reportId, r.date, r.projectName, r.targetLang || 'all',
          iss.id, iss.category, iss.subcategory, iss.severity,
          iss.penaltyPoints, iss.confidence, iss.status, iss.rootCause,
          iss.source, iss.target, iss.explanation, iss.suggestion
        ];
        exportSheet.getRange(row, 1, 1, issRow.length).setValues([issRow]);
        const sev = (iss.severity || '').toLowerCase();
        const color = severityColors[sev] || '#ffffff';
        exportSheet.getRange(row, 8).setBackground(color);
        if (iss.status === 'approved') exportSheet.getRange(row, 11).setBackground('#d4edda');
        if (iss.status === 'rejected') exportSheet.getRange(row, 11).setBackground('#f8d7da');
        row++;
      });
    });

    // Spaltenbreiten anpassen
    exportSheet.autoResizeColumns(1, 12);
    exportSheet.setColumnWidth(13, 300); // Source
    exportSheet.setColumnWidth(14, 300); // Target
    exportSheet.setColumnWidth(15, 350); // Erkl?rung
    exportSheet.setColumnWidth(16, 300); // Vorschlag

    exportSheet.setFrozenRows(1);
    SpreadsheetApp.flush();

    logAudit_("Export", `LQA Export erstellt: ${reports.length} Reports, ${reports.reduce((s,r) => s + (r.issues||[]).length, 0)} Issues.`);

    return { success: true, url: ss.getUrl() + "#gid=" + exportSheet.getSheetId() };
  } catch(e) {
    Logger.log("exportReportsToSheet Error: " + e.message);
    return { success: false, error: e.message };
  }
}

// =====================================================================
// MEMORY RAG
// =====================================================================

function getMemoryExamples_(profileName) {
  try {
    const all = getAllReportsFromDb();
    if(!all.success || !all.reports) return { rejected: [], approved: [] };

    let rejected = [], approved = [];
    all.reports.forEach(r => {
      if(r.profileName === profileName || !profileName) {
        (r.issues || []).forEach(iss => {
          let memoryObj = { source: iss.source, target: iss.target, category: iss.category, subcategory: iss.subcategory, explanation: iss.explanation };
          if(iss.status === 'rejected' && rejected.length < 5) rejected.push(memoryObj);
          if(iss.status === 'approved' && approved.length < 5) approved.push(memoryObj);
        });
      }
    });
    return { rejected, approved };
  } catch(e) { return { rejected: [], approved: [] }; }
}

// =====================================================================
// PROFILES
// =====================================================================

function getDefaultProfiles_() {
  return [
    {
      id: "mqm_core_standard", name: "MQM Core Standard", description: "Harmonized DQF-MQM typology",
      categories: [
        { name: "ACCURACY", enabled: true, subcategories: [ { name: "Accuracy", enabled: true, weight: 1.0 }, { name: "Mistranslation", enabled: true, weight: 1.0 }, { name: "Omission", enabled: true, weight: 1.0 }, { name: "Improper exact TM match", enabled: true, weight: 1.0 } ]},
        { name: "FLUENCY", enabled: true, subcategories: [ { name: "Fluency", enabled: true, weight: 1.0 }, { name: "Grammar", enabled: true, weight: 1.0 }, { name: "Spelling", enabled: true, weight: 1.0 } ]},
        { name: "TERMINOLOGY", enabled: true, subcategories: [ { name: "Inconsistent with termbase", enabled: true, weight: 1.5 }, { name: "Terminology", enabled: true, weight: 1.5 } ]},
        { name: "STYLE", enabled: true, subcategories: [ { name: "Style", enabled: true, weight: 1.0 }, { name: "Unidiomatic", enabled: true, weight: 1.0 } ]}
      ],
      severityPenalties: { "Neutral": 0, "Minor": 1, "Major": 5, "Critical": 10 }, passThreshold: 99.0, promptExtras: ""
    }
  ];
}

function getLQAProfiles() {
  try {
    const ss = getDbSheet_();
    const sheet = ss.getSheetByName("Profiles");
    const data = sheet.getDataRange().getValues();

    if(data.length <= 1) {
      const defs = getDefaultProfiles_();
      defs.forEach(p => sheet.appendRow([p.id, p.name, JSON.stringify(p)]));
      return { success: true, profiles: defs };
    }

    const profiles = [];
    for(let i=1; i<data.length; i++) {
      if(data[i][2] && String(data[i][2]).trim() !== "") {
        try {
          profiles.push(JSON.parse(data[i][2]));
        } catch(err) {
          Logger.log("?berspringe kaputte Profil-Zeile " + (i+1) + ": " + err.message);
        }
      }
    }

    if (profiles.length === 0) {
      return { success: true, profiles: getDefaultProfiles_() };
    }

    return { success: true, profiles: profiles };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function saveLQAProfile(profile) {
  try {
    const ss = getDbSheet_();
    const sheet = ss.getSheetByName("Profiles");
    const data = sheet.getDataRange().getValues();
    let updated = false;
    for(let i=1; i<data.length; i++) {
      if(data[i][0] === profile.id) {
        sheet.getRange(i+1, 2).setValue(profile.name);
        sheet.getRange(i+1, 3).setValue(JSON.stringify(profile));
        updated = true; break;
      }
    }
    if(!updated) sheet.appendRow([profile.id, profile.name, JSON.stringify(profile)]);
    logAudit_("Profile Saved", `Profile ${profile.name} (${profile.id}) saved.`);
    return getLQAProfiles();
  } catch (e) { return { success: false, error: e.message }; }
}

function deleteLQAProfile(profileId) {
  try {
    const ss = getDbSheet_();
    const sheet = ss.getSheetByName("Profiles");
    const data = sheet.getDataRange().getValues();
    for(let i=1; i<data.length; i++) {
      if(data[i][0] === profileId) { sheet.deleteRow(i+1); break; }
    }
    logAudit_("Profile Deleted", `Profile ${profileId} deleted.`);
    return getLQAProfiles();
  } catch (e) { return { success: false, error: e.message }; }
}

function resetLQAProfiles() {
  try {
    const ss = getDbSheet_();
    const sheet = ss.getSheetByName("Profiles");
    sheet.clearContents();
    sheet.appendRow(["ID", "Name", "JSON Data"]);
    const defs = getDefaultProfiles_();
    defs.forEach(p => sheet.appendRow([p.id, p.name, JSON.stringify(p)]));
    logAudit_("Profiles Reset", "All profiles reset to default.");
    return { success: true, profiles: defs };
  } catch (e) { return { success: false, error: e.message }; }
}