// SVX Leave Tracker — Apps Script v9
// Employees: name|code|email|full_time|reporting_manager|role|shift
// Submissions: empCode|empName|month|year|leavesFull|leavesHalf|weekendWork|holidayWork|wwHours|mailSent|submittedAt
// Holidays: date|type  (type = "public" or "optional")
// Admins: username|password|display_name

function doGet(e)  { return route(e); }
function doPost(e) { return route(e); }

function route(e) {
  try {
    var a = e.parameter.action;
    if (a === 'login')           return J(login(e.parameter));
    if (a === 'getEmployees')    return J(getEmployees());
    if (a === 'getSubmissions')  return J(getSubs(e.parameter.month, e.parameter.year));
    if (a === 'getSettings')     return J(getSettings());
    if (a === 'getHolidays')     return J(getHolidays());
    if (a === 'submit')          return J(submit(JSON.parse(e.postData.contents)));
    if (a === 'reset')           return J(resetMonth(JSON.parse(e.postData.contents)));
    if (a === 'setSettings')     return J(setSett(JSON.parse(e.postData.contents)));
    if (a === 'setHolidays')     return J(setHolidays(JSON.parse(e.postData.contents)));
    if (a === 'addEmployee')     return J(addEmployee(JSON.parse(e.postData.contents)));
    if (a === 'updateEmployee')  return J(updateEmployee(JSON.parse(e.postData.contents)));
    if (a === 'deleteEmployee')  return J(deleteEmployee(JSON.parse(e.postData.contents)));
    return J({ error: 'Unknown action: ' + a });
  } catch (err) { return J({ error: err.toString() }); }
}

function J(d) { return ContentService.createTextOutput(JSON.stringify(d)).setMimeType(ContentService.MimeType.JSON); }
function S(n) { return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(n); }

// ═══ DATE CLEAN ═══
function cleanDate(v) {
  if (!v) return '';
  if (v instanceof Date && !isNaN(v.getTime())) {
    return v.getFullYear() + '-' + ('0' + (v.getMonth() + 1)).slice(-2) + '-' + ('0' + v.getDate()).slice(-2);
  }
  var s = String(v).trim();
  if (s.charAt(0) === "'") s = s.substring(1);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return '';
}
function cleanDates(arr) {
  var seen = {}, out = [];
  for (var i = 0; i < arr.length; i++) {
    var v = cleanDate(arr[i]);
    if (v && !seen[v]) { seen[v] = true; out.push(v); }
  }
  return out.sort();
}

// ═══ LOGIN ═══
function login(p) {
  if (p.type === 'admin') {
    var s = S('Admins'); if (!s) return { success: false, error: 'Admins tab missing' };
    var d = s.getDataRange().getValues();
    for (var i = 1; i < d.length; i++)
      if (String(d[i][0]).trim().toLowerCase() === String(p.username).trim().toLowerCase() && String(d[i][1]) === String(p.password))
        return { success: true, role: 'admin', name: String(d[i][2] || d[i][0]) };
    return { success: false, error: 'Invalid credentials' };
  }
  var s = S('Employees'); if (!s) return { success: false, error: 'Employees tab missing' };
  var d = s.getDataRange().getValues();
  for (var i = 1; i < d.length; i++)
    if (String(d[i][2]).trim().toLowerCase() === String(p.email).trim().toLowerCase())
      return {
        success: true, role: 'employee',
        name: String(d[i][0]),
        code: d[i][1] ? Number(d[i][1]) : null,
        email: String(d[i][2]).trim(),
        fullTime: d[i][3] == 1,
        reportingManager: String(d[i][4] || ''),
        empRole: String(d[i][5] || ''),
        shift: String(d[i][6] || 'B')
      };
  return { success: false, error: 'Email not found' };
}

// ═══ EMPLOYEES ═══
function getEmployees() {
  var s = S('Employees'); if (!s) return { success: false, error: 'Employees tab missing' };
  var d = s.getDataRange().getValues(), out = [];
  for (var i = 1; i < d.length; i++) { if (!d[i][0]) continue;
    out.push({
      name: String(d[i][0]), code: d[i][1] ? Number(d[i][1]) : null,
      email: String(d[i][2] || '').trim(), fullTime: d[i][3] == 1,
      reportingManager: String(d[i][4] || ''), empRole: String(d[i][5] || ''),
      shift: String(d[i][6] || 'B')
    });
  }
  return { success: true, employees: out };
}

// ═══ SUBMISSIONS ═══
// Row: empCode|empName|month|year|leavesFull|leavesHalf|weekendWork|holidayWork|wwHours|mailSent|submittedAt
function getSubs(month, year) {
  var s = S('Submissions'); if (!s) return { success: true, submissions: {} };
  var d = s.getDataRange().getValues(), r = {};
  for (var i = 1; i < d.length; i++) {
    if (String(d[i][2]) !== String(month) || String(d[i][3]) !== String(year)) continue;
    var key = String(d[i][0] || d[i][1]) + '_' + month + '_' + year;
    r[key] = {
      empCode: d[i][0] ? Number(d[i][0]) : null,
      empName: String(d[i][1]),
      leavesFull: cleanDates(splitCell(d[i][4])),
      leavesHalf: cleanDates(splitCell(d[i][5])),
      weekendWork: cleanDates(splitCell(d[i][6])),
      holidayWork: cleanDates(splitCell(d[i][7])),
      wwHours: d[i][8] ? parseJSON(d[i][8]) : {},
      mailSent: d[i][9] === true || String(d[i][9]).toLowerCase() === 'true',
      at: String(d[i][10] || '')
    };
  }
  return { success: true, submissions: r };
}

function splitCell(v) {
  if (typeof v === 'string' || typeof v === 'number') return String(v).split(',');
  if (v instanceof Date) return [v];
  return [];
}
function parseJSON(v) { try { return JSON.parse(String(v)); } catch (e) { return {}; } }

// ═══ SUBMIT ═══
function submit(data) {
  if (data.weekendWork && data.weekendWork.length > 0 && !data.mailSent)
    return { success: false, error: 'Weekend work requires mail confirmation' };
  var sett = getSettings();
  if (!sett.open) return { success: false, error: 'Entries closed' };

  var s = S('Submissions'); if (!s) return { success: false, error: 'Submissions tab missing' };

  var lFull = cleanDates(data.leavesFull || []);
  var lHalf = cleanDates(data.leavesHalf || []);
  var ww = cleanDates(data.weekendWork || []);
  var hw = cleanDates(data.holidayWork || []);

  // Enforce no overlap: a date can be in only one bucket
  var seen = {};
  function pushUnique(arr) {
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      if (!seen[arr[i]]) { seen[arr[i]] = true; out.push(arr[i]); }
    }
    return out;
  }
  lFull = pushUnique(lFull);
  lHalf = pushUnique(lHalf);
  ww = pushUnique(ww);
  hw = pushUnique(hw);

  var all = s.getDataRange().getValues();
  var ek = String(data.empCode || data.empName);

  for (var i = 1; i < all.length; i++) {
    if (String(all[i][0] || all[i][1]) === ek && String(all[i][2]) === String(data.month) && String(all[i][3]) === String(data.year)) {
      var row = i + 1;
      s.getRange(row, 5).setNumberFormat('@').setValue(lFull.join(','));
      s.getRange(row, 6).setNumberFormat('@').setValue(lHalf.join(','));
      s.getRange(row, 7).setNumberFormat('@').setValue(ww.join(','));
      s.getRange(row, 8).setNumberFormat('@').setValue(hw.join(','));
      s.getRange(row, 9).setValue(JSON.stringify(data.wwHours || {}));
      s.getRange(row, 10).setValue(String(data.mailSent || false));
      s.getRange(row, 11).setValue(new Date().toISOString());
      return { success: true, msg: 'Updated' };
    }
  }
  var newRow = all.length + 1;
  s.appendRow([data.empCode || '', String(data.empName), data.month, data.year,
    lFull.join(','), lHalf.join(','), ww.join(','), hw.join(','),
    JSON.stringify(data.wwHours || {}), String(data.mailSent || false), new Date().toISOString()]);
  s.getRange(newRow, 5).setNumberFormat('@');
  s.getRange(newRow, 6).setNumberFormat('@');
  s.getRange(newRow, 7).setNumberFormat('@');
  s.getRange(newRow, 8).setNumberFormat('@');
  return { success: true, msg: 'Saved' };
}

function resetMonth(data) {
  var s = S('Submissions'); if (!s) return { success: false };
  var all = s.getDataRange().getValues(), rows = [];
  for (var i = 1; i < all.length; i++)
    if (String(all[i][2]) === String(data.month) && String(all[i][3]) === String(data.year)) rows.push(i + 1);
  for (var i = rows.length - 1; i >= 0; i--) s.deleteRow(rows[i]);
  return { success: true, cleared: rows.length };
}

// ═══ SETTINGS ═══
function getSettings() {
  var s = S('Settings');
  if (!s) return { period: { month: new Date().getMonth(), year: new Date().getFullYear() }, open: true };
  var d = s.getDataRange().getValues(), m = {};
  for (var i = 1; i < d.length; i++) m[String(d[i][0])] = d[i][1];
  return { period: { month: parseInt(m.activeMonth) || new Date().getMonth(), year: parseInt(m.activeYear) || new Date().getFullYear() }, open: String(m.entriesOpen) !== 'false' };
}

function setSett(data) {
  var s = S('Settings'); if (!s) return { success: false };
  s.clear(); s.appendRow(['key', 'value']);
  s.appendRow(['activeMonth', data.period.month]);
  s.appendRow(['activeYear', data.period.year]);
  s.appendRow(['entriesOpen', String(data.open)]);
  return { success: true };
}

// ═══ HOLIDAYS ═══
// Holidays tab: date | type   (type = "public" | "optional")
// Robust read: accepts YYYY-MM-DD strings, DD-MMM-YYYY strings, Date objects, apostrophe-prefixed strings.
// CRITICAL: only categorize as "public" when type cell EXPLICITLY says "public".
// When type is missing/blank/unknown, skip to avoid silently promoting optional → public.
function getHolidays() {
  var s = S('Holidays');
  if (!s) return { success: true, publicHolidays: [], optionalHolidays: [] };
  var d = s.getDataRange().getValues();
  var pub = [], opt = [];
  var months = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };

  for (var i = 1; i < d.length; i++) {
    var v = d[i][0];
    var typeRaw = String(d[i][1] || '').trim().toLowerCase();
    if (!v) continue;

    var ymdStr = '';

    // Case 1: Sheets auto-converted to Date object
    if (v instanceof Date && !isNaN(v.getTime())) {
      var y = v.getFullYear(), m = v.getMonth(), dd = v.getDate();
      ymdStr = y + '-' + ('0'+(m+1)).slice(-2) + '-' + ('0'+dd).slice(-2);
    } else {
      // Case 2: string — could be YYYY-MM-DD or DD-MMM-YYYY
      var s2 = String(v).trim();
      if (s2.charAt(0) === "'") s2 = s2.substring(1); // strip apostrophe prefix

      // Try YYYY-MM-DD first (this is what setHolidays writes)
      if (/^\d{4}-\d{2}-\d{2}$/.test(s2)) {
        ymdStr = s2;
      } else {
        // Try DD-MMM-YYYY
        var match = s2.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
        if (match) {
          var dd = parseInt(match[1]);
          var mon = months[match[2].toLowerCase()];
          var yy = parseInt(match[3]);
          if (mon !== undefined && !isNaN(dd) && !isNaN(yy)) {
            ymdStr = yy + '-' + ('0'+(mon+1)).slice(-2) + '-' + ('0'+dd).slice(-2);
          }
        }
      }
    }

    if (!ymdStr) continue; // unparseable row, skip

    // STRICT categorization: only explicit "public" goes to public.
    // Everything else (including blank/unknown) goes to optional — safer default
    // because disabling a date in the Leave section is more disruptive than allowing it.
    if (typeRaw === 'public') {
      pub.push(ymdStr);
    } else {
      opt.push(ymdStr);
    }
  }
  return { success: true, publicHolidays: pub, optionalHolidays: opt };
}

function setHolidays(data) {
  var s = S('Holidays');
  if (!s) s = SpreadsheetApp.getActiveSpreadsheet().insertSheet('Holidays');
  s.clear();
  s.appendRow(['date', 'type']);
  var pub = data.publicHolidays || [];
  var opt = data.optionalHolidays || [];
  var row = 2;
  for (var i = 0; i < pub.length; i++) {
    s.getRange(row, 1).setNumberFormat('@').setValue(String(pub[i]));
    s.getRange(row, 2).setValue('public');
    row++;
  }
  for (var i = 0; i < opt.length; i++) {
    s.getRange(row, 1).setNumberFormat('@').setValue(String(opt[i]));
    s.getRange(row, 2).setValue('optional');
    row++;
  }
  return { success: true, publicCount: pub.length, optionalCount: opt.length };
}

// ═══ EMPLOYEE CRUD ═══
function addEmployee(data) {
  var s = S('Employees'); if (!s) return { success: false, error: 'Employees tab missing' };
  var emp = data.employee;
  if (!emp || !emp.name || !emp.email) return { success: false, error: 'Name and email required' };
  s.appendRow([
    String(emp.name), emp.code || '', String(emp.email).trim(),
    emp.fullTime ? 1 : 0, emp.reportingManager || '',
    emp.empRole || '', emp.shift || 'B'
  ]);
  return { success: true, msg: 'Added' };
}

function updateEmployee(data) {
  var s = S('Employees'); if (!s) return { success: false, error: 'Employees tab missing' };
  var idx = data.index, emp = data.employee;
  if (idx === undefined || idx === null || !emp) return { success: false, error: 'Invalid data' };
  var row = idx + 2;
  if (row < 2 || row > s.getLastRow()) return { success: false, error: 'Row out of range' };
  s.getRange(row, 1).setValue(String(emp.name));
  s.getRange(row, 2).setValue(emp.code || '');
  s.getRange(row, 3).setValue(String(emp.email || '').trim());
  s.getRange(row, 4).setValue(emp.fullTime ? 1 : 0);
  s.getRange(row, 5).setValue(emp.reportingManager || '');
  s.getRange(row, 6).setValue(emp.empRole || '');
  s.getRange(row, 7).setValue(emp.shift || 'B');
  return { success: true, msg: 'Updated' };
}

function deleteEmployee(data) {
  var s = S('Employees'); if (!s) return { success: false, error: 'Employees tab missing' };
  var idx = data.index;
  if (idx === undefined || idx === null) return { success: false, error: 'Invalid index' };
  var row = idx + 2;
  if (row < 2 || row > s.getLastRow()) return { success: false, error: 'Row out of range' };
  s.deleteRow(row);
  return { success: true, msg: 'Deleted' };
}
