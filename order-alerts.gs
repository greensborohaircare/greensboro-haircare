/* =====================================================================
   GREENSBORO HAIRCARE — AUTOMATIC ORDER ALERTS  (Google Apps Script)

   When a customer taps Submit on the order site, this script:
     1. Emails the full order to OWNER_EMAIL (sent from your Gmail, free)
     2. Texts a short version to OWNER_PHONE (Textbelt, about $3 per 50 texts)
     3. Attaches a 4 x 6 inch PACKING SLIP (PDF) to your order email —
        open it on the iPhone/iPad, tap Share -> Print, pick your AirPrint printer
     4. Optionally emails the customer a copy of their receipt

   ONE-TIME SETUP (about 10 minutes)
   ---------------------------------
   1. Sign in to Google as the account that should SEND the emails
      (e.g. greensborohaircarewarehouse@gmail.com). Go to script.google.com -> New project.
   2. Delete what's there, paste this whole file in, and click Save.
   3. TEXTS: go to textbelt.com, buy a credit pack, and copy the API key
      they give you. Paste it into TEXTBELT_KEY below. (Leave it blank to
      get email only.)
   4. Pick "testSetup" in the function dropdown at the top and click Run.
      Then pick "testPackingSlip" and click Run — you get a sample 4 x 6
      packing slip by email. (Google asks permission for Docs/Drive the first
      time: the slip is built as a temporary Google Doc, saved as a PDF,
      then the Doc is moved to the trash.)
      Google asks for permission the first time — click through and Allow.
      You should get a test email and a test text within a minute.
   5. Click Deploy -> New deployment -> gear icon -> Web app.
        Execute as:      Me
        Who has access:  Anyone
      Click Deploy and copy the "Web app URL".
   6. Open index.html, find   const ORDER_ENDPOINT = "";
      and paste the URL between the quotes. Re-upload the site.

   ORDERS + PACKING SLIPS: every order is also kept here (the newest 150),
   so the site's Owner tools -> Orders tab can list them and print a 4 x 6
   packing slip for any of them from your iPhone or iPad. The order email
   also has a "Print packing slip" button that opens it.

   DISCOUNTS: codes and the scheduled discount you save in the site's
   Owner tools are stored here (Project Settings -> Script Properties),
   so every customer gets them. The Owner tools password is ADMIN_PASSWORD.

   If you edit this script later: Deploy -> Manage deployments -> pencil ->
   Version: New version -> Deploy. (The URL stays the same.)
   ===================================================================== */

const CONFIG = {
  OWNER_EMAIL: "greensborohaircarewarehouse@gmail.com",   // where order emails go (comma-separate for more than one)
  OWNER_PHONE: "3363145959",               // where order texts go (10 digits, comma-separate for more)
  TEXTBELT_KEY: "6b22f9879b8c95659c3eb44fabb0b770ad64acd9cng1yzhv0XeN1Qzb3ycrgwQLM",                        // paste your Textbelt key here
  SEND_CUSTOMER_COPY: true,                // email the customer their receipt too
  PACKING_SLIP: true,                      // attach a 4 x 6 packing slip PDF to your order email
  STORE_NAME: "Greensboro Haircare",
  ADMIN_PASSWORD: "Artis"                  // the password for the ⚙ Owner tools on the site — change it to your own
};

/* ---------- discounts shared with every customer ---------- */
function loadPromos() {
  const raw = PropertiesService.getScriptProperties().getProperty("PROMOS");
  try { return raw ? JSON.parse(raw) : null; } catch (err) { return null; }
}
function cleanStamp(v) { v = String(v || "").slice(0, 16); return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) ? v : ""; }
function cleanTime(v, fb) { v = String(v || ""); return /^\d{2}:\d{2}$/.test(v) ? v : fb; }
function cleanPromos(p) {
  const discounts = (Array.isArray(p.discounts) ? p.discounts : []).slice(0, 100).map(function (d) {
    const type = d.type === "amt" ? "amt" : "pct";
    let value = Math.max(0, Number(d.value) || 0);
    if (type === "pct") value = Math.min(100, value);
    return {
      code: String(d.code || "").toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 30),
      type: type, value: value, min: Math.max(0, Number(d.min) || 0), on: d.on !== false,
      note: String(d.note || "").slice(0, 200), start: cleanStamp(d.start), end: cleanStamp(d.end)
    };
  }).filter(function (d) { return d.code; });
  const a = p.autoDiscount || {};
  const day = function (v, fb) { v = Number(v); return v >= 0 && v <= 6 ? Math.floor(v) : fb; };
  const autoDiscount = {
    on: !!a.on, pct: Math.min(100, Math.max(0, Number(a.pct) || 0)),
    label: String(a.label || "Weekend special").slice(0, 60),
    startDay: day(a.startDay, 6), startTime: cleanTime(a.startTime, "17:00"),
    endDay: day(a.endDay, 2), endTime: cleanTime(a.endTime, "12:00"), stack: !!a.stack,
    // The specific date ranges the discount runs (e.g. Sat 5 PM -> Tue noon).
    windows: (Array.isArray(a.windows) ? a.windows : []).slice(0, 120).map(function (w) {
      return { start: cleanStamp(w && w.start), end: cleanStamp(w && w.end) };
    }).filter(function (w) { return w.start && w.end && w.end > w.start; })
  };
  return { discounts: discounts, autoDiscount: autoDiscount };
}
/* What customers get: only codes that are switched on, without your notes. */
function publicPromos(p) {
  if (!p) return { ok: true };
  return {
    ok: true,
    discounts: p.discounts.filter(function (d) { return d.on; })
      .map(function (d) { return { code: d.code, type: d.type, value: d.value, min: d.min, on: true, start: d.start, end: d.end }; }),
    autoDiscount: p.autoDiscount
  };
}
function checkPassword(pw) {
  if (!CONFIG.ADMIN_PASSWORD) return "Set ADMIN_PASSWORD in the Google script first";
  // Slow down password guessing: max 10 wrong tries per 10 minutes.
  const cache = CacheService.getScriptCache();
  const fails = Number(cache.get("pwfails") || 0);
  if (fails >= 10) return "Too many wrong tries — wait 10 minutes";
  if (String(pw) !== String(CONFIG.ADMIN_PASSWORD)) { cache.put("pwfails", String(fails + 1), 600); return "That password didn't match"; }
  return "";
}

function doGet(e) {
  if (e && e.parameter && e.parameter.action === "promos") return reply(publicPromos(loadPromos()));
  return reply({ ok: true, service: "order alerts" });
}

function doPost(e) {
  try {
    const o = JSON.parse((e && e.postData && e.postData.contents) || "{}");

    if (o.action === "login" || o.action === "savePromos" || o.action === "orders") {
      const bad = checkPassword(o.password);
      if (bad) return reply({ ok: false, error: bad });
      if (o.action === "orders") return reply({ ok: true, orders: listOrders(o.order) });
      if (o.action === "savePromos") {
        const clean = cleanPromos(o);
        PropertiesService.getScriptProperties().setProperty("PROMOS", JSON.stringify(clean));
        return reply({ ok: true, discounts: clean.discounts, autoDiscount: clean.autoDiscount });
      }
      const p = loadPromos();
      return reply(p ? { ok: true, discounts: p.discounts, autoDiscount: p.autoDiscount } : { ok: true });
    }

    // Ignore anything that isn't a real order from the site.
    if (!o.order_number || !/^ORD-\d{8}-\d{4}$/.test(o.order_number) || !Array.isArray(o.items) || !o.items.length) {
      return reply({ ok: false, error: "not an order" });
    }
    // Don't double-send if the customer's phone retries.
    const cache = CacheService.getScriptCache();
    if (cache.get(o.order_number)) return reply({ ok: true, duplicate: true });

    const result = { email: false, sms: false, customer: false };

    try { saveOrder(o); result.saved = true; } catch (err) { result.saveError = String(err); }

    // Packing slip first — if it ever fails, the order email still goes out.
    let slip = null;
    if (CONFIG.PACKING_SLIP) {
      try { slip = packingSlipPdf(o); result.slip = true; }
      catch (err) { result.slipError = String(err); }
    }

    try {
      MailApp.sendEmail({
        to: CONFIG.OWNER_EMAIL,
        subject: o.subject || ("New order " + o.order_number),
        body: o.full_receipt || "",
        htmlBody: orderHtml(o, true, !!slip),
        attachments: slip ? [slip] : [],
        replyTo: o.email || undefined,
        name: CONFIG.STORE_NAME + " Orders"
      });
      result.email = true;
    } catch (err) { result.emailError = String(err); }

    if (CONFIG.TEXTBELT_KEY) {
      String(CONFIG.OWNER_PHONE).split(",").forEach(function (num) {
        const r = sendText(num.trim(), o.sms_text || o.subject);
        if (r.success) result.sms = true; else result.smsError = r.error || "text failed";
      });
    }

    if (CONFIG.SEND_CUSTOMER_COPY && o.email && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(o.email)) {
      try {
        MailApp.sendEmail({
          to: o.email,
          subject: CONFIG.STORE_NAME + " — your order " + o.order_number,
          body: o.full_receipt || "",
          htmlBody: orderHtml(o, false),
          replyTo: CONFIG.OWNER_EMAIL.split(",")[0],
          name: CONFIG.STORE_NAME
        });
        result.customer = true;
      } catch (err) { result.customerError = String(err); }
    }

    result.ok = result.email || result.sms;
    if (result.ok) cache.put(o.order_number, "1", 6 * 60 * 60);
    return reply(result);
  } catch (err) {
    return reply({ ok: false, error: String(err) });
  }
}

function sendText(phone, message) {
  try {
    const res = UrlFetchApp.fetch("https://textbelt.com/text", {
      method: "post",
      payload: { phone: phone, message: message, key: CONFIG.TEXTBELT_KEY },
      muteHttpExceptions: true
    });
    return JSON.parse(res.getContentText());
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

function orderHtml(o, forOwner, hasSlip) {
  const esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
  const td = 'style="padding:6px 8px;border-bottom:1px solid #e3e8ef"';
  const rows = o.items.map(function (l) {
    return "<tr><td " + td + ">" + esc(l.qty) + "×</td><td " + td + ">" + esc(l.name) +
      (l.shade ? " <b>" + esc(l.shade) + "</b>" : "") + " <span style=\"color:#7c8fa3\">" + esc(l.size) + "</span></td>" +
      "<td " + td + " align=\"right\">" + esc(l.line) + "</td></tr>";
  }).join("");
  const raw = function (k, html) { return html ? "<tr><td style=\"padding:3px 8px;color:#53687e\">" + k + "</td><td style=\"padding:3px 8px\">" + html + "</td></tr>" : ""; };
  const line = function (k, v) { return v ? "<tr><td style=\"padding:3px 8px;color:#53687e\">" + k + "</td><td style=\"padding:3px 8px\">" + esc(v) + "</td></tr>" : ""; };
  return '<div style="font-family:Arial,sans-serif;max-width:560px;color:#132433">' +
    '<h2 style="margin:0 0 4px">' + (forOwner ? "New order " : "Thanks for your order — ") + esc(o.order_number) + '</h2>' +
    '<p style="margin:0 0 14px;color:#53687e">' + esc(o.placed_at) + '</p>' +
    (forOwner ? '<p style="padding:10px 12px;background:' + (/^PAID/.test(o.payment_status) ? "#e4f3eb" : "#fbeedd") +
      ';border-radius:6px;font-weight:bold">' + esc(o.payment_status) + '</p>' : "") +
    (forOwner && slipLink(o) ? '<p style="margin:0 0 14px"><a href="' + esc(slipLink(o)) + '" style="display:inline-block;padding:10px 16px;background:#132433;color:#fff;border-radius:6px;text-decoration:none;font-weight:bold">Print packing slip</a></p>' : "") +
    (forOwner && hasSlip ? '<p style="margin:0 0 14px;color:#53687e">\uD83D\uDCCE Packing slip also attached (4 x 6). Tap it, then Share \u2192 Print.</p>' : "") +
    '<table style="border-collapse:collapse;width:100%">' + rows + '</table>' +
    '<table style="margin-top:10px">' +
      line("Subtotal", o.subtotal) + line("Discount", o.discount) + line("Tax", o.tax) +
      line("Delivery", o.delivery) + '<tr><td style="padding:3px 8px"><b>Total</b></td><td style="padding:3px 8px"><b>' + esc(o.total) + '</b></td></tr>' +
    '</table>' +
    '<h3 style="margin:18px 0 6px">Customer</h3><table>' +
      line("Name", o.customer) + line("Shop", o.shop) + line("License", o.license) + line("Sales rep", o.sales_rep) +
      raw("Phone", o.phone ? '<a href="tel:' + esc(String(o.phone).replace(/[^\d+]/g, "")) + '">' + esc(o.phone) + '</a>' : "") +
      raw("Email", o.email ? '<a href="mailto:' + esc(o.email) + '">' + esc(o.email) + '</a>' : "") +
    '</table>' +
    '<h3 style="margin:18px 0 6px">Deliver to</h3>' +
    '<p style="margin:0 8px;line-height:1.5">' + esc(o.address).replace(/\n/g, "<br>") +
      (forOwner ? '<br><a href="https://www.google.com/maps/search/?api=1&query=' +
        encodeURIComponent(String(o.address || "").replace(/\n/g, ", ")) + '">Open in Google Maps</a>' : "") + '</p>' +
    '<table style="margin-top:8px">' + line("Notes", o.delivery_notes) + line("Payment", o.payment_method) + '</table>' +
    (forOwner ? "" : '<p style="color:#53687e">We\'ll confirm by text or call, then deliver next day. Questions? Just reply to this email.</p>') +
    '</div>';
}

/* =====================================================================
   PACKING SLIP — 4 x 6 inch PDF, no prices or payment info.
   Built as a temporary Google Doc (exact page size), saved as PDF, and the
   Doc is moved to the trash. Long orders continue onto extra slips; every
   slip repeats the order number and customer name and says "Slip 1 of 2".
   ===================================================================== */
function packingSlipPdf(o) {
  const W = 288, H = 432, M = 16;            // 4 x 6 in, in points
  const usable = H - 2 * M - 22;              // keep a safety gap so Docs never spills over
  const colBox = 24, colQty = 34, colName = W - 2 * M - colBox - colQty;

  const items = (o.items || []).map(function (l) {
    const name = String(l.name || "") + (l.shade ? " — " + l.shade : "") + (l.size ? "  ·  " + l.size : "");
    const lines = Math.max(1, Math.ceil(name.length / 26));
    return { qty: String(l.qty || ""), name: name, h: 12 + lines * 15 };
  });
  const totalUnits = (o.items || []).reduce(function (n, l) { return n + (Number(l.qty) || 0); }, 0);

  const addr = String(o.address || "").split("\n").filter(String);
  const notes = String(o.delivery_notes || "").slice(0, 300);
  const firstHead = 50 + 20 + 16 + (o.shop ? 15 : 0) + addr.length * 16 + 16 +
                    (o.sales_rep ? 14 : 0) + (notes ? 14 + Math.ceil(notes.length / 40) * 13 : 0) + 14 + 24;
  const contHead = 58 + 24;
  const signoff = 26 + 4 * 26;

  // Split the items into slips by height.
  const pages = [];
  let cur = [], room = usable - firstHead;
  items.forEach(function (it) {
    if (it.h > room && cur.length) { pages.push(cur); cur = []; room = usable - contHead; }
    cur.push(it); room -= it.h;
  });
  pages.push(cur);
  if (room < signoff) pages.push([]);          // sign-off box gets its own slip if it won't fit
  const n = pages.length;

  const doc = DocumentApp.create("Packing slip " + o.order_number);
  const body = doc.getBody();
  body.setPageWidth(W).setPageHeight(H)
      .setMarginTop(M).setMarginBottom(M).setMarginLeft(M).setMarginRight(M);

  let first = true;
  const para = function (text, size, bold, color) {
    let p;
    if (first) { p = body.getParagraphs()[0]; p.setText(text); first = false; }
    else p = body.appendParagraph(text);
    p.setSpacingBefore(0).setSpacingAfter(2).setLineSpacing(1);
    const tx = p.editAsText();
    tx.setFontFamily("Arial").setFontSize(size).setBold(!!bold).setForegroundColor(color || "#000000");
    return p;
  };
  const labelValue = function (label, value, size) {
    const p = para(label + value, size || 11, false);
    p.editAsText().setBold(0, label.length - 1, true);
    return p;
  };
  const styleTable = function (tbl, widths, fontSize) {
    tbl.setBorderWidth(1).setBorderColor("#000000");
    widths.forEach(function (w, i) { tbl.setColumnWidth(i, w); });
    for (let r = 0; r < tbl.getNumRows(); r++) {
      const row = tbl.getRow(r);
      for (let c = 0; c < row.getNumCells(); c++) {
        const cell = row.getCell(c);
        cell.setPaddingTop(4).setPaddingBottom(4).setPaddingLeft(4).setPaddingRight(4);
        cell.editAsText().setFontFamily("Arial").setFontSize(fontSize).setBold(false);
        for (let k = 0; k < cell.getNumChildren(); k++) {
          const ch = cell.getChild(k);
          if (ch.getType() === DocumentApp.ElementType.PARAGRAPH) ch.asParagraph().setSpacingBefore(0).setSpacingAfter(0);
        }
      }
    }
    return tbl;
  };

  pages.forEach(function (rows, i) {
    if (i > 0) body.appendPageBreak();
    para((CONFIG.STORE_NAME || "").toUpperCase() + "   ·   SLIP " + (i + 1) + " OF " + n, 8, true, "#444444");
    para("PACKING SLIP", 16, true);
    labelValue("Order ", o.order_number + "   " + String(o.placed_at || "").replace(/:\d\d(?= [AP]M)/, ""), 10);

    if (i === 0) {
      para("DELIVER TO", 8, true, "#444444").setSpacingBefore(6);
      para(o.customer || "", 15, true);
      if (o.shop) para(o.shop, 11, false);
      addr.forEach(function (line) { para(line, 12, false); });
      labelValue("Phone: ", o.phone || "", 12);
      if (o.sales_rep) labelValue("Sales rep: ", o.sales_rep, 10);
      if (notes) labelValue("Delivery notes: ", notes, 11);
    } else {
      para("continued — " + (o.customer || ""), 11, true);
    }

    if (rows.length) {
      const data = [["Got", "Qty", "Product · size"]].concat(rows.map(function (it) { return ["", it.qty, it.name]; }));
      const tbl = styleTable(body.appendTable(data), [colBox, colQty, colName], 12);
      const head = tbl.getRow(0);
      for (let c = 0; c < 3; c++) head.getCell(c).setBackgroundColor("#e6e6e6").editAsText().setFontSize(9).setBold(true);
      for (let r = 1; r < tbl.getNumRows(); r++) tbl.getRow(r).getCell(1).editAsText().setBold(true).setFontSize(14);
    }

    if (i === n - 1) {
      labelValue("Total items: ", totalUnits + "  (" + items.length + " product" + (items.length === 1 ? "" : "s") + ")", 12)
        .setSpacingBefore(6);
      styleTable(body.appendTable([
        ["Pulled & checked by (initials)", ""],
        ["Date / time pulled", ""],
        ["Driver verified (initials)", ""],
        ["Delivered — date / time", ""]
      ]), [150, W - 2 * M - 150], 9);
    }
  });

  doc.saveAndClose();
  const file = DriveApp.getFileById(doc.getId());
  const pdf = file.getAs(MimeType.PDF).setName("Packing slip " + o.order_number + ".pdf");
  file.setTrashed(true);
  return pdf;
}

/* Run this from the editor to get a sample packing slip by email. */
function testPackingSlip() {
  const names = ["Hydrating Conditioner", "Moisture Lock w/ Shea Butter", "Coconut Milk Leave In",
    "Coconut Milk Styling Foam", "Coconut Milk Super Hold Glazed Edges", "Body Butter — Coconut Milk"];
  const items = [];
  for (let i = 0; i < 14; i++) items.push({ name: names[i % names.length], size: i % 3 ? "8 oz" : "32 oz", qty: (i % 4) + 1 });
  const o = {
    order_number: "ORD-00000000-0000", placed_at: new Date().toLocaleString("en-US", { timeZone: "America/New_York" }),
    customer: "Sample Customer", shop: "Sample Salon", phone: "(336) 555-0100", sales_rep: "Sample Rep",
    address: "1000 Westside Drive, Suite 4\nGreensboro, NC 27405",
    delivery_notes: "Side door by the parking lot. Call when outside.", items: items
  };
  const pdf = packingSlipPdf(o);
  MailApp.sendEmail({ to: CONFIG.OWNER_EMAIL, subject: CONFIG.STORE_NAME + " — sample packing slip",
    body: "Here is a sample 4 x 6 packing slip (14 products, so it runs onto a second slip).", attachments: [pdf] });
  Logger.log("Sample packing slip emailed to " + CONFIG.OWNER_EMAIL);
}

/* ---------- saved orders (for Owner tools -> Orders) ---------- */
const KEEP_ORDERS = 150;
function saveOrder(o) {
  const rec = {
    n: o.order_number, iso: String(o.placed_iso || ""), at: String(o.placed_at || ""),
    c: o.customer || "", s: o.shop || "", ph: o.phone || "", r: o.sales_rep || "",
    a: o.address || "", no: String(o.delivery_notes || "").slice(0, 500),
    ps: o.payment_status || "", tot: o.total || "",
    it: (o.items || []).map(function (l) { return { n: l.name || "", sh: l.shade || "", sz: l.size || "", q: l.qty }; })
  };
  let json = JSON.stringify(rec);
  if (json.length > 8500) { rec.no = ""; json = JSON.stringify(rec); }
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const props = PropertiesService.getScriptProperties();
    props.setProperty("O:" + o.order_number, json);
    let ids = [];
    try { ids = JSON.parse(props.getProperty("ORDER_IDS") || "[]"); } catch (err) { ids = []; }
    ids = ids.filter(function (x) { return x !== o.order_number; });
    ids.unshift(o.order_number);
    ids.slice(KEEP_ORDERS).forEach(function (old) { props.deleteProperty("O:" + old); });
    props.setProperty("ORDER_IDS", JSON.stringify(ids.slice(0, KEEP_ORDERS)));
  } finally { lock.releaseLock(); }
}
function listOrders(only) {
  const props = PropertiesService.getScriptProperties();
  let ids = [];
  try { ids = JSON.parse(props.getProperty("ORDER_IDS") || "[]"); } catch (err) { ids = []; }
  if (only) ids = ids.filter(function (x) { return x === only; });
  return ids.slice(0, 100).map(function (id) {
    try { return JSON.parse(props.getProperty("O:" + id) || "null"); } catch (err) { return null; }
  }).filter(Boolean);
}
/* Link that opens this order's packing slip on the site (asks for the Owner password). */
function slipLink(o) {
  const u = String(o.page_url || "");
  return /^https:\/\//.test(u) ? u.split("#")[0] + "#slip=" + encodeURIComponent(o.order_number) : "";
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* Run this once from the editor to grant permissions and check everything works. */
function testSetup() {
  MailApp.sendEmail(CONFIG.OWNER_EMAIL, CONFIG.STORE_NAME + " — order alerts are working",
    "This is a test. Real orders from the site will arrive here the moment a customer taps Submit.");
  Logger.log("Test email sent to " + CONFIG.OWNER_EMAIL);
  if (CONFIG.TEXTBELT_KEY) {
    const r = sendText(String(CONFIG.OWNER_PHONE).split(",")[0].trim(), CONFIG.STORE_NAME + ": order text alerts are working.");
    Logger.log("Text result: " + JSON.stringify(r));
  } else {
    Logger.log("No TEXTBELT_KEY yet — skipping the test text.");
  }
  Logger.log("Emails left today: " + MailApp.getRemainingDailyQuota());
}
