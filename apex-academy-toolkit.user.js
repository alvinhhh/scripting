// ==UserScript==
// @name         Apex Academy Toolkit
// @namespace    local.apex.academy.toolkit
// @version      1.0.0
// @description  Combined Gmail and Google Calendar tools: draft duplication, Apex invoice/payroll helper, student reminder copying, and Day-view calendar labels.
// @match        https://mail.google.com/*
// @match        https://calendar.google.com/*
// @run-at       document-idle
// @grant        GM_setClipboard
// @grant        GM_getValue
// @grant        GM_setValue
// @noframes
// @require      https://cdnjs.cloudflare.com/ajax/libs/pdf.js/1.10.100/pdf.combined.js
// @require      https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js
// ==/UserScript==
(() => {
'use strict';
if (location.hostname === 'mail.google.com') {
(() => {
'use strict';
if (window.__gmailDraftDuplicatorV31) return;
window.__gmailDraftDuplicatorV31 = true;
const TYPES = ['to', 'cc', 'bcc'];
const BODY_SELECTOR = [
'.Ap [g_editable="true"]',
'[g_editable="true"][contenteditable="true"]',
'[contenteditable="true"][role="textbox"]'
].join(',');
const CONFIG = {
POLL_MS: 100,
AFTER_FILL_MS: 1500,
AFTER_MINIMIZE_MS: 2500,
NEW_COMPOSE_TIMEOUT: 10000,
MINIMIZE_TIMEOUT: 6000
};
let batch = null;
let panel = null;
let panelText = null;
let stopButton = null;
let dismissButton = null;
const sleep = ms =>
new Promise(resolve => setTimeout(resolve, ms));
const all = (root, selector) =>
[...root.querySelectorAll(selector)];
const visible = el =>
!!el &&
el.isConnected &&
el.getClientRects().length > 0 &&
getComputedStyle(el).visibility !== 'hidden' &&
getComputedStyle(el).display !== 'none';
const bodyOf = root =>
root?.querySelector(BODY_SELECTOR);
function composes() {
return [
...new Set(
all(document, 'input[name="subjectbox"]')
.map(input =>
input.closest('.M9') ||
input.closest('[role="dialog"]')
)
.filter(root => root && bodyOf(root))
)
];
}
function checkStopped() {
if (batch?.stopped) {
throw new Error('Batch stopped.');
}
}
async function waitFor(test, timeout, errorMessage) {
const end = Date.now() + timeout;
while (Date.now() < end) {
checkStopped();
const result = test();
if (result) {
return result;
}
await sleep(CONFIG.POLL_MS);
}
throw new Error(errorMessage);
}
const style = document.createElement('style');
style.textContent = `
.gdd-controls {
display: flex;
gap: 6px;
padding: 5px 0;
flex-wrap: wrap;
}
.gdd-button {
border: 1px solid #c6dafc;
border-radius: 6px;
padding: 6px 11px;
background: #e8f0fe;
color: #174ea6;
cursor: pointer;
font: 500 12px Arial, sans-serif;
white-space: nowrap;
}
.gdd-button:hover {
background: #d2e3fc;
}
.gdd-button:disabled {
opacity: .5;
cursor: wait;
}
#gdd-panel {
position: fixed;
top: 16px;
left: 50%;
transform: translateX(-50%);
z-index: 2147483647;
background: #202124;
color: white;
padding: 12px 16px;
border-radius: 8px;
box-shadow: 0 4px 18px rgba(0,0,0,.3);
font: 14px/1.5 Arial, sans-serif;
min-width: 320px;
max-width: min(650px, 90vw);
}
#gdd-panel[hidden] {
display: none;
}
#gdd-panel-text {
white-space: pre-wrap;
}
#gdd-panel-actions {
margin-top: 9px;
display: flex;
justify-content: flex-end;
gap: 6px;
}
`;
document.head.appendChild(style);
function makeButton(text, callback) {
const button = document.createElement('button');
button.type = 'button';
button.className = 'gdd-button';
button.textContent = text;
button.addEventListener('click', event => {
event.preventDefault();
event.stopPropagation();
callback();
});
return button;
}
function showStatus(text, running = false) {
if (!panel) {
panel = document.createElement('div');
panel.id = 'gdd-panel';
panelText = document.createElement('div');
panelText.id = 'gdd-panel-text';
const actions = document.createElement('div');
actions.id = 'gdd-panel-actions';
stopButton = makeButton('Stop batch', () => {
if (batch) {
batch.stopped = true;
showStatus(
`Stopping...\n${batch.completed}/${batch.total} completed.`,
true
);
}
});
dismissButton = makeButton('Dismiss', () => {
panel.hidden = true;
});
actions.append(stopButton, dismissButton);
panel.append(panelText, actions);
document.body.appendChild(panel);
}
panel.hidden = false;
panelText.textContent = text;
stopButton.hidden = !running;
dismissButton.hidden = running;
}
function clickNative(el) {
if (!el) {
throw new Error('Required Gmail button was not found.');
}
el.dispatchEvent(
new PointerEvent('pointerdown', {
bubbles: true,
cancelable: true,
pointerType: 'mouse',
isPrimary: true,
button: 0,
buttons: 1
})
);
el.dispatchEvent(
new MouseEvent('mousedown', {
bubbles: true,
cancelable: true,
button: 0,
buttons: 1
})
);
el.dispatchEvent(
new PointerEvent('pointerup', {
bubbles: true,
cancelable: true,
pointerType: 'mouse',
isPrimary: true,
button: 0,
buttons: 0
})
);
el.dispatchEvent(
new MouseEvent('mouseup', {
bubbles: true,
cancelable: true,
button: 0,
buttons: 0
})
);
el.click();
}
function recipientInputs(root, type) {
return all(
root,
`
textarea[name="${type}"],
input[name="${type}"]:not([type="hidden"]),
div[name="${type}"] input:not([type="hidden"]),
div[name="${type}"] textarea
`
).filter(el => !el.disabled);
}
function recipientNodes(root, type) {
return all(
root,
`
input[type="hidden"][name="${type}"],
div[name="${type}"] [data-hovercard-id],
div[name="${type}"] [email]
`
);
}
function addresses(root, type) {
const results = new Map();
for (const node of recipientNodes(root, type)) {
const raw =
node.getAttribute('data-hovercard-id') ||
node.getAttribute('email') ||
node.value ||
'';
let email =
raw.match(/<([^<>]+)>/)?.[1] ||
raw;
email = email.trim();
if (!email) continue;
if (/^[^\s<>@,;]+@[^\s<>@,;]+$/.test(email)) {
results.set(
email.toLowerCase(),
email
);
}
}
return [...results.values()];
}
function sameAddresses(a, b) {
const aa = new Set(
a.map(x => x.toLowerCase())
);
const bb = new Set(
b.map(x => x.toLowerCase())
);
return (
aa.size === bb.size &&
[...aa].every(x => bb.has(x))
);
}
async function expandRecipients(root) {
const collapsed =
root.querySelector('div.aoD.hl');
if (visible(collapsed)) {
collapsed.click();
await sleep(150);
}
}
function dispatchChanged(el, inputType = 'insertText') {
el.dispatchEvent(
new InputEvent('input', {
bubbles: true,
inputType,
data: null
})
);
el.dispatchEvent(
new Event('change', {
bubbles: true
})
);
}
function setInputValue(el, value) {
const proto =
el.tagName === 'TEXTAREA'
? HTMLTextAreaElement.prototype
: HTMLInputElement.prototype;
const setter =
Object.getOwnPropertyDescriptor(
proto,
'value'
).set;
setter.call(el, value);
dispatchChanged(el);
}
function tabKey(el) {
for (const type of ['keydown', 'keyup']) {
el.dispatchEvent(
new KeyboardEvent(type, {
key: 'Tab',
code: 'Tab',
keyCode: 9,
which: 9,
bubbles: true,
cancelable: true
})
);
}
}
async function revealRecipientInput(root, type) {
await expandRecipients(root);
let input =
recipientInputs(root, type).find(visible);
if (input) {
return input;
}
if (type === 'cc') {
root.querySelector('span.pE')?.click();
}
if (type === 'bcc') {
root.querySelector('span.pB')?.click();
}
return waitFor(
() =>
recipientInputs(root, type)
.find(visible),
4000,
`Could not find Gmail's ${type.toUpperCase()} field.`
);
}
async function fillRecipients(root, type, wanted) {
if (!wanted.length) {
return;
}
let input =
await revealRecipientInput(root, type);
input.focus();
try {
const transfer = new DataTransfer();
transfer.setData(
'text/plain',
wanted.join(', ') + ','
);
input.dispatchEvent(
new ClipboardEvent('paste', {
bubbles: true,
cancelable: true,
clipboardData: transfer
})
);
} catch (_) {}
await sleep(350);
const existing =
new Set(
addresses(root, type)
.map(x => x.toLowerCase())
);
const missing =
wanted.filter(
x =>
!existing.has(
x.toLowerCase()
)
);
if (missing.length) {
input =
await revealRecipientInput(root, type);
input.focus();
setInputValue(
input,
missing.join(', ')
);
tabKey(input);
bodyOf(root)?.focus();
await sleep(400);
}
await waitFor(
() =>
sameAddresses(
addresses(root, type),
wanted
),
5000,
`${type.toUpperCase()} recipients did not copy correctly.`
);
}
function cloneBody(body) {
const wrapper =
document.createElement('div');
if (body.getAttribute('dir')) {
wrapper.setAttribute(
'dir',
body.getAttribute('dir')
);
}
const styles = [
'font-family',
'font-size',
'font-weight',
'font-style',
'color',
'background-color',
'line-height',
'text-align',
'text-decoration',
'direction'
];
for (const property of styles) {
const value =
body.style.getPropertyValue(property);
if (value) {
wrapper.style.setProperty(
property,
value
);
}
}
for (const node of body.childNodes) {
wrapper.appendChild(
node.cloneNode(true)
);
}
return wrapper;
}
function triggerBodyChange(body) {
body.dispatchEvent(
new InputEvent('input', {
bubbles: true,
inputType: 'insertFromPaste',
data: null
})
);
body.dispatchEvent(
new Event('change', {
bubbles: true
})
);
for (const type of [
'keydown',
'keypress',
'keyup'
]) {
body.dispatchEvent(
new KeyboardEvent(type, {
key: '.',
code: 'Period',
keyCode: 190,
which: 190,
bubbles: true,
cancelable: true
})
);
}
}
async function snapshotSource(source) {
if (
!source ||
!source.isConnected
) {
throw new Error(
'The source draft is no longer open.'
);
}
await expandRecipients(source);
const recipients = {};
for (const type of TYPES) {
recipients[type] =
addresses(source, type);
}
const subject =
source.querySelector(
'input[name="subjectbox"]'
)?.value ?? '';
const sourceBody =
bodyOf(source);
if (!sourceBody) {
throw new Error(
'Could not find the source message body.'
);
}
return {
subject,
recipients,
body: cloneBody(sourceBody)
};
}
function composeButton() {
return all(
document,
`
.z0 [role="button"],
[gh="cm"],
.T-I.T-I-KE.L3
`
).find(
el =>
visible(el) &&
!el.closest('.M9')
);
}
async function openBlankCompose() {
const existing =
new Set(composes());
const button =
composeButton();
if (!button) {
throw new Error(
'Could not find Gmail Compose button.'
);
}
clickNative(button);
const compose =
await waitFor(
() =>
composes().find(
root =>
!existing.has(root) &&
visible(bodyOf(root))
),
CONFIG.NEW_COMPOSE_TIMEOUT,
'Gmail did not open another compose window.'
);
await sleep(400);
return compose;
}
async function populateCompose(root, snapshot) {
for (const type of TYPES) {
await fillRecipients(
root,
type,
snapshot.recipients[type]
);
}
const subject =
root.querySelector(
'input[name="subjectbox"]'
);
if (!subject) {
throw new Error(
'Could not find the subject field.'
);
}
setInputValue(
subject,
snapshot.subject
);
const body =
bodyOf(root);
if (!body) {
throw new Error(
'Could not find the new draft body.'
);
}
body.focus();
body.replaceChildren(
snapshot.body.cloneNode(true)
);
triggerBodyChange(body);
body.blur();
await sleep(CONFIG.AFTER_FILL_MS);
if (
subject.value !== snapshot.subject
) {
throw new Error(
'Subject verification failed.'
);
}
for (const type of TYPES) {
if (
!sameAddresses(
addresses(root, type),
snapshot.recipients[type]
)
) {
throw new Error(
`${type.toUpperCase()} verification failed.`
);
}
}
}
function minimizeButton(root) {
const exact =
root.querySelector(
'button.Hl[aria-label="Minimize"], ' +
'button.Hl[data-tooltip="Minimize"]'
);
if (visible(exact)) {
return exact;
}
const container =
root.closest('.AD') ||
root.closest('[role="dialog"]') ||
root.parentElement;
if (container) {
const nearby =
container.querySelector(
'button.Hl[aria-label="Minimize"], ' +
'button.Hl[data-tooltip="Minimize"]'
);
if (visible(nearby)) {
return nearby;
}
}
const semantic =
all(
container || root,
`
button[aria-label="Minimize"],
button[data-tooltip="Minimize"]
`
).find(visible);
if (semantic) {
return semantic;
}
const classFallback =
all(
container || root,
'button.Hl, .Hl'
).find(visible);
if (classFallback) {
return classFallback;
}
return null;
}
async function minimizeDraft(root) {
const button =
minimizeButton(root);
if (!button) {
console.log(
'[Gmail Draft Duplicator] Compose root:',
root
);
throw new Error(
'Could not identify Gmail\'s Minimize button.'
);
}
console.log(
'[Gmail Draft Duplicator] Clicking minimize:',
button
);
const originalExpanded =
button.getAttribute('aria-expanded');
clickNative(button);
await waitFor(
() => {
const currentButton =
minimizeButton(root);
if (
currentButton &&
originalExpanded === 'true' &&
currentButton.getAttribute('aria-expanded') === 'false'
) {
return true;
}
const body =
bodyOf(root);
if (
body &&
!visible(body)
) {
return true;
}
const composeArea =
root.querySelector('.Ap');
if (
composeArea &&
!visible(composeArea)
) {
return true;
}
return false;
},
CONFIG.MINIMIZE_TIMEOUT,
'Gmail did not appear to minimize the draft.'
);
await sleep(
CONFIG.AFTER_MINIMIZE_MS
);
}
async function createCopy(
snapshot,
index,
total,
shouldMinimize
) {
checkStopped();
showStatus(
total > 1
? `Creating ${index}/${total}...\n` +
`${batch.completed} completed so far.`
: 'Creating duplicate...',
!!batch
);
const compose =
await openBlankCompose();
if (batch) {
batch.current = compose;
}
await populateCompose(
compose,
snapshot
);
if (shouldMinimize) {
showStatus(
`Copy ${index}/${total} filled.\n` +
`Minimizing draft...`,
true
);
await minimizeDraft(compose);
}
return compose;
}
async function runSingle(source) {
if (batch) {
return;
}
try {
const snapshot =
await snapshotSource(source);
await createCopy(
snapshot,
1,
1,
false
);
showStatus(
'Duplicate created and left open.\nNothing was sent.'
);
} catch (error) {
console.error(
'[Gmail Draft Duplicator]',
error
);
showStatus(
`${error.message}\nNothing was sent.`
);
}
}
async function runBatch(source) {
if (batch) {
return;
}
const answer =
prompt(
'How many NEW copies should be created?\n\n' +
'Each copy will be filled, allowed to autosave, then minimized.',
'10'
);
if (answer === null) {
return;
}
const trimmed =
answer.trim();
const total =
Number(trimmed);
if (
!/^\d+$/.test(trimmed) ||
!Number.isSafeInteger(total) ||
total < 1
) {
alert(
'Enter a positive whole number.'
);
return;
}
if (
total > 100 &&
!confirm(
`Create ${total} new Gmail drafts?`
)
) {
return;
}
batch = {
total,
completed: 0,
current: null,
stopped: false
};
updateButtons();
try {
const snapshot =
await snapshotSource(source);
for (
let i = 1;
i <= total;
i++
) {
checkStopped();
batch.current = null;
await createCopy(
snapshot,
i,
total,
true
);
batch.completed = i;
batch.current = null;
showStatus(
`${i}/${total} drafts created and minimized.`,
true
);
await sleep(500);
}
showStatus(
`Done.\n` +
`${total} new drafts were created and minimized.\n` +
`Nothing was sent.`
);
} catch (error) {
console.error(
'[Gmail Draft Duplicator]',
error
);
const completed =
batch?.completed ?? 0;
showStatus(
`${error.message}\n\n` +
`${completed}/${total} copies completed.\n` +
`Any unfinished compose was left open.\n` +
`Nothing was sent.`
);
} finally {
batch = null;
updateButtons();
}
}
function updateButtons() {
for (
const button
of all(
document,
'.gdd-button'
)
) {
if (
!button.closest('#gdd-panel')
) {
button.disabled = !!batch;
}
}
}
function scan() {
for (
const compose
of composes()
) {
if (
compose.querySelector(
'.gdd-controls'
)
) {
continue;
}
const toolbar =
compose.querySelector('.aDh');
if (!toolbar) {
continue;
}
const controls =
document.createElement('div');
controls.className =
'gdd-controls';
controls.append(
makeButton(
'Duplicate draft',
() => {
void runSingle(compose);
}
),
makeButton(
'Batch duplicate...',
() => {
void runBatch(compose);
}
)
);
toolbar.prepend(controls);
}
updateButtons();
}
let scanPending = false;
new MutationObserver(() => {
if (scanPending) {
return;
}
scanPending = true;
setTimeout(() => {
scanPending = false;
scan();
}, 150);
}).observe(
document.body,
{
childList: true,
subtree: true
}
);
window.addEventListener(
'beforeunload',
event => {
if (!batch) {
return;
}
event.preventDefault();
event.returnValue = '';
}
);
scan();
})();
}
if (location.hostname === 'mail.google.com') {
(() => {
'use strict';
if (window.__APEX_GMAIL_HELPER_V22__) return;
window.__APEX_GMAIL_HELPER_V22__ = true;
const CC_ADDRESS = 'blee@apexacademyprep.com';
const INVOICE_SUBJECT = 'Apex Academy Invoice';
const BODY_SELECTOR = [
'.Ap [g_editable="true"]',
'[g_editable="true"][contenteditable="true"]',
'[contenteditable="true"][role="textbox"]'
].join(',');
const CONFIG = {
POLL_MS: 100,
AFTER_FILL_MS: 1500,
AFTER_ATTACH_MS: 1500,
AFTER_MINIMIZE_MS: 2500,
NEW_COMPOSE_TIMEOUT: 10000,
MINIMIZE_TIMEOUT: 7000,
ATTACH_TIMEOUT: 20000
};
let batch = null;
let statusPanel = null;
let statusText = null;
let stopButton = null;
let dismissButton = null;
let openMenu = null;
const composeButtons = new WeakMap();
const sleep = ms =>
new Promise(resolve => setTimeout(resolve, ms));
const all = (root, selector) =>
[...root.querySelectorAll(selector)];
const visible = el =>
!!el &&
el.isConnected &&
el.getClientRects().length > 0 &&
getComputedStyle(el).visibility !== 'hidden' &&
getComputedStyle(el).display !== 'none';
const bodyOf = root =>
root?.querySelector(BODY_SELECTOR);
function composeContainer(root) {
return (
root?.closest('.AD') ||
root?.closest('[role="dialog"]') ||
root?.parentElement ||
root
);
}
function composes() {
return [
...new Set(
all(document, 'input[name="subjectbox"]')
.map(input =>
input.closest('.M9') ||
input.closest('[role="dialog"]')
)
.filter(root =>
root &&
bodyOf(root)
)
)
];
}
function checkStopped() {
if (batch?.stopped) {
throw new Error('Payroll batch stopped.');
}
}
async function waitFor(
test,
timeout = 10000,
errorMessage = 'Timed out.'
) {
const end =
Date.now() + timeout;
while (
Date.now() < end
) {
checkStopped();
let result = null;
try {
result = test();
} catch (_) {}
if (result) {
return result;
}
await sleep(
CONFIG.POLL_MS
);
}
throw new Error(
errorMessage
);
}
const style =
document.createElement(
'style'
);
style.textContent = `
#apex-helper-status {
position: fixed;
top: 16px;
left: 50%;
transform: translateX(-50%);
z-index: 2147483647;
min-width: 340px;
max-width: min(650px, 90vw);
padding: 12px 16px;
border-radius: 8px;
background: #202124;
color: #fff;
box-shadow: 0 4px 18px rgba(0,0,0,.3);
font: 14px/1.5 Arial, sans-serif;
}
#apex-helper-status[hidden] {
display: none;
}
#apex-helper-status-text {
white-space: pre-wrap;
}
#apex-helper-status-actions {
margin-top: 9px;
display: flex;
justify-content: flex-end;
gap: 7px;
}
.apex-status-button {
border: 1px solid #5f6368;
border-radius: 5px;
padding: 5px 10px;
background: #303134;
color: #fff;
cursor: pointer;
}
.apex-titlebar-host {
position: relative !important;
}
.apex-compose-button {
position: absolute !important;
left: 50% !important;
top: 50% !important;
transform: translate(-50%, -50%) !important;
z-index: 10 !important;
margin: 0 !important;
box-sizing: border-box;
height: 30px;
min-width: 82px;
padding: 0 11px;
border: 1px solid rgba(255,255,255,.18);
border-radius: 8px;
background: rgba(255,255,255,.09);
color: inherit;
cursor: pointer;
font: 500 14px Arial, sans-serif;
white-space: nowrap;
}
.apex-compose-button:hover {
background: rgba(255,255,255,.17);
}
#apex-helper-menu {
position: fixed;
z-index: 2147483647;
min-width: 170px;
padding: 6px 0;
border: 1px solid #dadce0;
border-radius: 8px;
background: #fff;
color: #202124;
box-shadow: 0 6px 18px rgba(0,0,0,.22);
font: 14px Arial, sans-serif;
}
.apex-helper-menu-item {
padding: 10px 16px;
cursor: pointer;
white-space: nowrap;
}
.apex-helper-menu-item:hover {
background: #f1f3f4;
}
`;
document.head.appendChild(
style
);
function makeStatusButton(
text,
callback
) {
const button =
document.createElement(
'button'
);
button.type =
'button';
button.className =
'apex-status-button';
button.textContent =
text;
button.addEventListener(
'click',
event => {
event.preventDefault();
event.stopPropagation();
callback();
}
);
return button;
}
function showStatus(
message,
running = false
) {
if (!statusPanel) {
statusPanel =
document.createElement(
'div'
);
statusPanel.id =
'apex-helper-status';
statusText =
document.createElement(
'div'
);
statusText.id =
'apex-helper-status-text';
const actions =
document.createElement(
'div'
);
actions.id =
'apex-helper-status-actions';
stopButton =
makeStatusButton(
'Stop',
() => {
if (!batch) {
return;
}
batch.stopped =
true;
showStatus(
`Stopping...\n${batch.completed}/${batch.total} completed.`,
true
);
}
);
dismissButton =
makeStatusButton(
'Dismiss',
() => {
statusPanel.hidden =
true;
}
);
actions.append(
stopButton,
dismissButton
);
statusPanel.append(
statusText,
actions
);
document.body.appendChild(
statusPanel
);
}
statusPanel.hidden =
false;
statusText.textContent =
message;
stopButton.hidden =
!running;
dismissButton.hidden =
running;
}
function clickNative(el) {
if (!el) {
throw new Error(
'Required Gmail button was not found.'
);
}
el.dispatchEvent(
new PointerEvent(
'pointerdown',
{
bubbles: true,
cancelable: true,
pointerType: 'mouse',
isPrimary: true,
button: 0,
buttons: 1
}
)
);
el.dispatchEvent(
new MouseEvent(
'mousedown',
{
bubbles: true,
cancelable: true,
button: 0,
buttons: 1
}
)
);
el.dispatchEvent(
new PointerEvent(
'pointerup',
{
bubbles: true,
cancelable: true,
pointerType: 'mouse',
isPrimary: true,
button: 0,
buttons: 0
}
)
);
el.dispatchEvent(
new MouseEvent(
'mouseup',
{
bubbles: true,
cancelable: true,
button: 0,
buttons: 0
}
)
);
el.click();
}
function recipientInputs(
root,
type
) {
return all(
root,
`
textarea[name="${type}"],
input[name="${type}"]:not([type="hidden"]),
div[name="${type}"] input:not([type="hidden"]),
div[name="${type}"] textarea
`
).filter(
el =>
!el.disabled
);
}
function recipientNodes(
root,
type
) {
return all(
root,
`
input[type="hidden"][name="${type}"],
div[name="${type}"] [data-hovercard-id],
div[name="${type}"] [email]
`
);
}
function addresses(
root,
type
) {
const results =
new Map();
for (
const node
of recipientNodes(
root,
type
)
) {
const raw =
node.getAttribute(
'data-hovercard-id'
) ||
node.getAttribute(
'email'
) ||
node.value ||
'';
let email =
raw.match(
/<([^<>]+)>/
)?.[1] ||
raw;
email =
email.trim();
if (!email) {
continue;
}
if (
/^[^\s<>@,;]+@[^\s<>@,;]+$/
.test(email)
) {
results.set(
email.toLowerCase(),
email
);
}
}
return [
...results.values()
];
}
function sameAddresses(
a,
b
) {
const aa =
new Set(
a.map(
x =>
x.toLowerCase()
)
);
const bb =
new Set(
b.map(
x =>
x.toLowerCase()
)
);
return (
aa.size === bb.size &&
[...aa].every(
x =>
bb.has(x)
)
);
}
async function expandRecipients(
root
) {
const collapsed =
root.querySelector(
'div.aoD.hl'
);
if (
visible(collapsed)
) {
collapsed.click();
await sleep(
150
);
}
}
function dispatchChanged(
el,
inputType = 'insertText'
) {
el.dispatchEvent(
new InputEvent(
'input',
{
bubbles: true,
inputType,
data: null
}
)
);
el.dispatchEvent(
new Event(
'change',
{
bubbles: true
}
)
);
}
function setInputValue(
el,
value
) {
const proto =
el.tagName ===
'TEXTAREA'
? HTMLTextAreaElement.prototype
: HTMLInputElement.prototype;
const setter =
Object
.getOwnPropertyDescriptor(
proto,
'value'
)
?.set;
if (setter) {
setter.call(
el,
value
);
} else {
el.value =
value;
}
dispatchChanged(
el
);
}
function tabKey(el) {
for (
const type
of [
'keydown',
'keyup'
]
) {
el.dispatchEvent(
new KeyboardEvent(
type,
{
key: 'Tab',
code: 'Tab',
keyCode: 9,
which: 9,
bubbles: true,
cancelable: true
}
)
);
}
}
async function revealRecipientInput(
root,
type
) {
await expandRecipients(
root
);
let input =
recipientInputs(
root,
type
).find(
visible
);
if (input) {
return input;
}
if (
type === 'cc'
) {
root
.querySelector(
'span.pE'
)
?.click();
}
if (
type === 'bcc'
) {
root
.querySelector(
'span.pB'
)
?.click();
}
return waitFor(
() =>
recipientInputs(
root,
type
).find(
visible
),
4000,
`Could not find Gmail's ${type.toUpperCase()} field.`
);
}
async function fillRecipients(
root,
type,
wanted
) {
if (
!wanted.length
) {
return;
}
if (
sameAddresses(
addresses(
root,
type
),
wanted
)
) {
return;
}
let input =
await revealRecipientInput(
root,
type
);
input.focus();
try {
const transfer =
new DataTransfer();
transfer.setData(
'text/plain',
wanted.join(', ') + ','
);
input.dispatchEvent(
new ClipboardEvent(
'paste',
{
bubbles: true,
cancelable: true,
clipboardData:
transfer
}
)
);
} catch (_) {}
await sleep(
350
);
const existing =
new Set(
addresses(
root,
type
).map(
x =>
x.toLowerCase()
)
);
const missing =
wanted.filter(
email =>
!existing.has(
email.toLowerCase()
)
);
if (
missing.length
) {
input =
await revealRecipientInput(
root,
type
);
input.focus();
setInputValue(
input,
missing.join(', ')
);
tabKey(
input
);
bodyOf(root)
?.focus();
await sleep(
400
);
}
await waitFor(
() =>
sameAddresses(
addresses(
root,
type
),
wanted
),
5000,
`${type.toUpperCase()} recipient did not populate correctly.`
);
}
function triggerBodyChange(
body
) {
body.dispatchEvent(
new InputEvent(
'input',
{
bubbles: true,
inputType:
'insertFromPaste',
data: null
}
)
);
body.dispatchEvent(
new Event(
'change',
{
bubbles: true
}
)
);
for (
const type
of [
'keydown',
'keypress',
'keyup'
]
) {
body.dispatchEvent(
new KeyboardEvent(
type,
{
key: '.',
code: 'Period',
keyCode: 190,
which: 190,
bubbles: true,
cancelable: true
}
)
);
}
}
function textDiv(
text = ''
) {
const div =
document.createElement(
'div'
);
if (text) {
div.textContent =
text;
} else {
div.appendChild(
document.createElement(
'br'
)
);
}
return div;
}
function signatureLine(
text,
phoneLink = false
) {
const div =
document.createElement(
'div'
);
div.style.color =
'rgb(102, 102, 102)';
if (phoneLink) {
const a =
document.createElement(
'a'
);
a.href =
'tel:+17145867907';
a.target =
'_blank';
a.textContent =
text;
div.appendChild(
a
);
} else {
div.textContent =
text;
}
return div;
}
function buildInvoiceBody() {
const wrapper =
document.createElement(
'div'
);
wrapper.setAttribute(
'dir',
'ltr'
);
wrapper.style.fontFamily =
'Arial, sans-serif';
const hello =
document.createElement(
'div'
);
hello.textContent =
'Hello!';
wrapper.appendChild(
hello
);
wrapper.appendChild(
textDiv()
);
const intro =
document.createElement(
'div'
);
intro.textContent =
"We hope you're doing well. We've calculated the tutoring cost for x:";
wrapper.appendChild(
intro
);
wrapper.appendChild(
textDiv()
);
const payment =
document.createElement(
'div'
);
payment.style.fontFamily =
'Arial, sans-serif';
payment.style.fontSize =
'13px';
payment.appendChild(
document.createTextNode(
'Your total comes out to\u00A0'
)
);
const amount =
document.createElement(
'span'
);
amount.textContent =
'$x';
amount.style.fontWeight =
'bold';
amount.style.fontStyle =
'italic';
amount.style.textDecoration =
'underline';
amount.style.backgroundColor =
'rgb(217, 234, 211)';
payment.appendChild(
amount
);
payment.appendChild(
document.createTextNode(
'.\u00A0We accept payments via Zelle (ID:\u00A0'
)
);
const zelle =
document.createElement(
'a'
);
zelle.href =
'tel:+19518186997';
zelle.target =
'_blank';
zelle.textContent =
'9518186997';
payment.appendChild(
zelle
);
payment.appendChild(
document.createTextNode(
'), Checks (payable to Apex Academy LLC), Venmo (@ Benjamin-Lee-22), or Cash.'
)
);
wrapper.appendChild(
payment
);
wrapper.appendChild(
textDiv()
);
const questions =
document.createElement(
'div'
);
questions.style.fontSize =
'13px';
questions.textContent =
'Please let us know if you have any questions or need any additional information.';
wrapper.appendChild(
questions
);
wrapper.appendChild(
textDiv()
);
const thanks =
document.createElement(
'div'
);
thanks.style.fontSize =
'13px';
thanks.textContent =
'Thank you!';
wrapper.appendChild(
thanks
);
wrapper.appendChild(
textDiv()
);
const signature =
document.createElement(
'div'
);
signature.setAttribute(
'dir',
'ltr'
);
signature.className =
'gmail_signature';
signature.appendChild(
signatureLine(
'Office Manager at Apex Academy LLC'
)
);
signature.appendChild(
signatureLine(
'1800 East Lambert Road #288'
)
);
signature.appendChild(
signatureLine(
'Brea, CA 92821'
)
);
signature.appendChild(
signatureLine(
'714-586-7907',
true
)
);
wrapper.appendChild(
signature
);
return wrapper;
}
function buildPaystubBody() {
const wrapper =
document.createElement(
'div'
);
wrapper.setAttribute(
'dir',
'ltr'
);
const body =
document.createElement(
'div'
);
body.appendChild(
document.createTextNode(
'Attached to this email is your\u00A0paystub.'
)
);
body.appendChild(
document.createElement(
'br'
)
);
body.appendChild(
document.createElement(
'br'
)
);
body.appendChild(
document.createTextNode(
'Please let us know if you have any questions.'
)
);
body.appendChild(
document.createElement(
'br'
)
);
body.appendChild(
document.createElement(
'br'
)
);
body.appendChild(
document.createTextNode(
'Thank you!'
)
);
wrapper.appendChild(
body
);
wrapper.appendChild(
textDiv()
);
const signature =
document.createElement(
'div'
);
signature.setAttribute(
'dir',
'ltr'
);
signature.className =
'gmail_signature';
signature.setAttribute(
'data-smartmail',
'gmail_signature'
);
signature.appendChild(
signatureLine(
'Office Manager at Apex Academy LLC'
)
);
signature.appendChild(
signatureLine(
'1800 East Lambert Road #288'
)
);
signature.appendChild(
signatureLine(
'Brea, CA 92821'
)
);
signature.appendChild(
signatureLine(
'714-586-7907'
)
);
wrapper.appendChild(
signature
);
return wrapper;
}
async function setBody(
root,
builder
) {
const body =
await waitFor(
() =>
bodyOf(root),
5000,
'Could not find Gmail message body.'
);
body.focus();
body.replaceChildren(
builder()
);
triggerBodyChange(
body
);
body.blur();
await sleep(
250
);
}
async function setSubject(
root,
subject
) {
const input =
await waitFor(
() =>
root.querySelector(
'input[name="subjectbox"]'
),
5000,
'Could not find Gmail subject field.'
);
input.focus();
setInputValue(
input,
subject
);
input.blur();
await sleep(
150
);
}
async function createInvoice(
root
) {
if (
!root ||
!root.isConnected
) {
throw new Error(
'Compose window is no longer open.'
);
}
showStatus(
'Creating invoice draft...'
);
await fillRecipients(
root,
'cc',
[
CC_ADDRESS
]
);
await setSubject(
root,
INVOICE_SUBJECT
);
await setBody(
root,
buildInvoiceBody
);
await sleep(
CONFIG.AFTER_FILL_MS
);
showStatus(
`Invoice filled.\n` +
`To: blank\n` +
`Cc: ${CC_ADDRESS}\n` +
`Nothing was sent.`
);
}
function getPdfLibraries() {
let PDFJS_LIB =
null;
let PDFLIB =
null;
try {
if (
typeof PDFJS !==
'undefined'
) {
PDFJS_LIB =
PDFJS;
}
} catch (_) {}
try {
if (
!PDFJS_LIB &&
typeof pdfjsLib !==
'undefined'
) {
PDFJS_LIB =
pdfjsLib;
}
} catch (_) {}
try {
if (
typeof PDFLib !==
'undefined'
) {
PDFLIB =
PDFLib;
}
} catch (_) {}
PDFJS_LIB =
PDFJS_LIB ||
globalThis.PDFJS ||
globalThis.pdfjsLib ||
window.PDFJS ||
window.pdfjsLib ||
null;
PDFLIB =
PDFLIB ||
globalThis.PDFLib ||
window.PDFLib ||
null;
try {
if (
PDFJS_LIB &&
'disableWorker' in
PDFJS_LIB
) {
PDFJS_LIB.disableWorker =
true;
}
} catch (_) {}
return {
PDFJS_LIB,
PDFLIB
};
}
function textItemsToLines(
items
) {
const usable =
items
.filter(
item =>
item?.str?.trim()
)
.map(
item => ({
text:
item.str.trim(),
x:
Number(
item.transform?.[4] ??
0
),
y:
Number(
item.transform?.[5] ??
0
)
})
);
const lines =
[];
for (
const item
of usable
) {
let line =
lines.find(
existing =>
Math.abs(
existing.y -
item.y
) < 2
);
if (!line) {
line = {
y:
item.y,
items:
[]
};
lines.push(
line
);
}
line.items.push(
item
);
}
lines.sort(
(a, b) =>
b.y -
a.y
);
return lines.map(
line =>
line.items
.sort(
(a, b) =>
a.x -
b.x
)
.map(
item =>
item.text
)
.join(' ')
.replace(
/\s+/g,
' '
)
.trim()
);
}
function extractEmployeeName(
lines
) {
for (
const line
of lines
) {
if (
!/\$\s*\*+\s*[\d,]+\.\d{2}/
.test(line)
) {
continue;
}
const beforeAmount =
line
.replace(
/\$\s*\*+\s*[\d,]+\.\d{2}.*$/,
''
)
.replace(
/\b\d{1,2}\/\d{1,2}\/\d{4}\b/g,
''
)
.trim();
const match =
beforeAmount.match(
/([A-Z][A-Z.'’\-]*(?:\s+[A-Z][A-Z.'’\-]*){1,5})$/
);
if (
match?.[1]
) {
return match[1]
.replace(
/\s+/g,
' '
)
.trim();
}
}
const text =
lines.join(' ');
const fallback =
text.match(
/\b([A-Z][A-Z.'’\-]*(?:\s+[A-Z][A-Z.'’\-]*){1,5})\s+\$\s*\*+\s*[\d,]+\.\d{2}\b/
);
return (
fallback?.[1]
?.replace(
/\s+/g,
' '
)
.trim() ||
null
);
}
function parseDateString(
str
) {
const match =
str.match(
/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/
);
if (!match) {
return null;
}
const month =
Number(
match[1]
);
const day =
Number(
match[2]
);
const year =
Number(
match[3]
);
return {
month,
day,
year,
timestamp:
new Date(
year,
month - 1,
day
).getTime()
};
}
function extractPayPeriod(
lines
) {
const matches =
lines
.join(' ')
.match(
/\b\d{1,2}\/\d{1,2}\/\d{4}\b/g
) ||
[];
const dates =
[
...new Set(
matches
)
]
.map(
parseDateString
)
.filter(
Boolean
)
.sort(
(a, b) =>
a.timestamp -
b.timestamp
);
if (
dates.length <
2
) {
return null;
}
return {
start:
dates[0],
end:
dates[1],
label:
`${dates[0].month}/${dates[0].day} - ` +
`${dates[1].month}/${dates[1].day}`
};
}
function titleCaseWord(
word
) {
return word
.toLowerCase()
.split(
/([-'’])/
)
.map(
part => {
if (
part === '-' ||
part === "'" ||
part === '’'
) {
return part;
}
if (!part) {
return part;
}
return (
part[0]
.toUpperCase() +
part.slice(1)
);
}
)
.join('');
}
function employeeFilename(
rawName
) {
const pieces =
rawName
.trim()
.replace(
/\s+/g,
' '
)
.split(' ');
if (
!pieces.length
) {
return (
'Paystub.pdf'
);
}
const first =
titleCaseWord(
pieces[0]
);
if (
pieces.length ===
1
) {
return (
`${first}.pdf`
);
}
if (
pieces.length ===
2
) {
return (
`${first} ` +
`${pieces[1].toUpperCase()}.pdf`
);
}
if (
/^[A-Z]$/i.test(
pieces[1]
)
) {
return (
`${first} ` +
`${pieces[1].toUpperCase()} ` +
`${pieces
.slice(2)
.join(' ')
.toUpperCase()}.pdf`
);
}
return (
`${first} ` +
`${pieces
.slice(1)
.join(' ')
.toUpperCase()}.pdf`
);
}
async function preparePayrollPDF(
file
) {
const {
PDFJS_LIB,
PDFLIB
} =
getPdfLibraries();
if (
!PDFJS_LIB ||
typeof
PDFJS_LIB.getDocument !==
'function'
) {
throw new Error(
'PDF parser failed to load. Reload Gmail after saving the updated script.'
);
}
if (
!PDFLIB?.PDFDocument
) {
throw new Error(
'PDF-Lib failed to load. Reload Gmail after saving the updated script.'
);
}
showStatus(
'Payroll: loading PDF...',
true
);
const original =
await file.arrayBuffer();
const pdfJsData =
new Uint8Array(
original.slice(0)
);
const pdfLibData =
original.slice(0);
const loadingTask =
PDFJS_LIB.getDocument(
pdfJsData
);
const textPdf =
loadingTask?.promise
? await loadingTask.promise
: await loadingTask;
const sourcePdf =
await PDFLIB
.PDFDocument
.load(
pdfLibData
);
const pageCount =
sourcePdf
.getPageCount();
if (
textPdf.numPages !==
pageCount
) {
throw new Error(
'PDF page counts did not match.'
);
}
const pages =
[];
let firstPageLines =
null;
for (
let pageNumber = 1;
pageNumber <=
pageCount;
pageNumber++
) {
checkStopped();
showStatus(
`Payroll: reading page ${pageNumber}/${pageCount}...`,
true
);
const page =
await textPdf
.getPage(
pageNumber
);
const content =
await page
.getTextContent();
const lines =
textItemsToLines(
content.items ||
[]
);
if (
pageNumber ===
1
) {
firstPageLines =
lines;
}
const employeeName =
extractEmployeeName(
lines
);
if (
!employeeName
) {
console.log(
'[Apex Payroll] Could not parse page',
pageNumber,
lines
);
throw new Error(
`Could not identify the employee on page ${pageNumber}. No payroll drafts were created.`
);
}
pages.push({
pageIndex:
pageNumber -
1,
pageNumber,
employeeName,
filename:
employeeFilename(
employeeName
)
});
}
const payPeriod =
extractPayPeriod(
firstPageLines ||
[]
);
if (
!payPeriod
) {
throw new Error(
'Could not determine the pay period from page 1. No payroll drafts were created.'
);
}
const employees =
[];
for (
let i = 0;
i <
pages.length;
i++
) {
checkStopped();
const info =
pages[i];
showStatus(
`Payroll: splitting ${i + 1}/${pages.length}\n${info.filename}`,
true
);
const output =
await PDFLIB
.PDFDocument
.create();
const [
copiedPage
] =
await output.copyPages(
sourcePdf,
[
info.pageIndex
]
);
output.addPage(
copiedPage
);
const bytes =
await output
.save();
const splitFile =
new File(
[
bytes
],
info.filename,
{
type:
'application/pdf'
}
);
employees.push({
...info,
file:
splitFile
});
}
return {
employees,
payPeriod
};
}
function composeButton() {
return all(
document,
`
.z0 [role="button"],
[gh="cm"],
.T-I.T-I-KE.L3
`
).find(
el =>
visible(el) &&
!el.closest(
'.M9'
)
);
}
async function openBlankCompose() {
const existing =
new Set(
composes()
);
const button =
composeButton();
if (!button) {
throw new Error(
'Could not find Gmail Compose button.'
);
}
clickNative(
button
);
const compose =
await waitFor(
() =>
composes()
.find(
root =>
!existing.has(
root
) &&
visible(
bodyOf(root)
)
),
CONFIG.NEW_COMPOSE_TIMEOUT,
'Gmail did not open another compose window.'
);
await sleep(
400
);
return compose;
}
function attachmentInput(
root
) {
const container =
composeContainer(
root
);
const inputs =
all(
container,
'input[type="file"]'
);
return (
inputs.find(
input =>
input.name ===
'Filedata'
) ||
inputs.find(
input =>
!/image/i.test(
input.accept ||
''
)
) ||
inputs[0] ||
null
);
}
function attachmentAppears(
root,
filename
) {
const container =
composeContainer(
root
);
const needle =
filename
.toLowerCase();
return all(
container,
`
[aria-label],
[title],
.vI,
.vA,
.aQH
`
).some(
el => {
const values =
[
el.getAttribute(
'aria-label'
),
el.getAttribute(
'title'
),
el.textContent
]
.filter(
Boolean
)
.map(
value =>
value
.toLowerCase()
.trim()
);
return values.some(
value =>
value.includes(
needle
)
);
}
);
}
async function attachFile(
root,
file
) {
const input =
await waitFor(
() =>
attachmentInput(
root
),
5000,
'Could not locate Gmail attachment input.'
);
const transfer =
new DataTransfer();
transfer.items.add(
file
);
const setter =
Object
.getOwnPropertyDescriptor(
HTMLInputElement.prototype,
'files'
)
?.set;
if (setter) {
setter.call(
input,
transfer.files
);
} else {
input.files =
transfer.files;
}
input.dispatchEvent(
new Event(
'change',
{
bubbles: true
}
)
);
await waitFor(
() =>
attachmentAppears(
root,
file.name
),
CONFIG.ATTACH_TIMEOUT,
`Gmail did not show attachment "${file.name}".`
);
await sleep(
CONFIG.AFTER_ATTACH_MS
);
}
function minimizeButton(
root
) {
const exact =
root.querySelector(
'button.Hl[aria-label="Minimize"], ' +
'button.Hl[data-tooltip="Minimize"]'
);
if (
visible(exact)
) {
return exact;
}
const container =
composeContainer(
root
);
const nearby =
container
?.querySelector(
'button.Hl[aria-label="Minimize"], ' +
'button.Hl[data-tooltip="Minimize"]'
);
if (
visible(nearby)
) {
return nearby;
}
const semantic =
all(
container ||
root,
`
button[aria-label="Minimize"],
button[data-tooltip="Minimize"]
`
).find(
visible
);
if (semantic) {
return semantic;
}
return (
all(
container ||
root,
'button.Hl, .Hl'
).find(
visible
) ||
null
);
}
async function minimizeDraft(
root
) {
const button =
minimizeButton(
root
);
if (!button) {
throw new Error(
'Could not identify Gmail\'s Minimize button.'
);
}
const originalExpanded =
button.getAttribute(
'aria-expanded'
);
clickNative(
button
);
await waitFor(
() => {
const current =
minimizeButton(
root
);
if (
current &&
originalExpanded ===
'true' &&
current.getAttribute(
'aria-expanded'
) ===
'false'
) {
return true;
}
const body =
bodyOf(
root
);
if (
body &&
!visible(body)
) {
return true;
}
const composeArea =
root.querySelector(
'.Ap'
);
if (
composeArea &&
!visible(
composeArea
)
) {
return true;
}
return false;
},
CONFIG.MINIMIZE_TIMEOUT,
'Gmail did not appear to minimize the draft.'
);
await sleep(
CONFIG.AFTER_MINIMIZE_MS
);
}
async function populatePayrollDraft(
root,
subject,
attachment
) {
await fillRecipients(
root,
'cc',
[
CC_ADDRESS
]
);
await setSubject(
root,
subject
);
await setBody(
root,
buildPaystubBody
);
await attachFile(
root,
attachment
);
await sleep(
CONFIG.AFTER_FILL_MS
);
const subjectInput =
root.querySelector(
'input[name="subjectbox"]'
);
if (
subjectInput
?.value !==
subject
) {
throw new Error(
'Subject verification failed.'
);
}
if (
!sameAddresses(
addresses(
root,
'cc'
),
[
CC_ADDRESS
]
)
) {
throw new Error(
'CC verification failed.'
);
}
if (
!attachmentAppears(
root,
attachment.name
)
) {
throw new Error(
`Attachment verification failed for ${attachment.name}.`
);
}
}
async function runPayroll(
sourceCompose,
uploadedFile
) {
if (batch) {
showStatus(
'A payroll batch is already running.'
);
return;
}
batch = {
total: 0,
completed: 0,
stopped: false,
current: null
};
try {
const prepared =
await preparePayrollPDF(
uploadedFile
);
batch.total =
prepared
.employees
.length;
const subject =
`Paystub ${prepared.payPeriod.label}`;
showStatus(
`Payroll parsed successfully.\n` +
`${batch.total} employees\n` +
`Subject: ${subject}`,
true
);
await sleep(
800
);
let compose =
sourceCompose &&
sourceCompose.isConnected &&
visible(
bodyOf(
sourceCompose
)
)
? sourceCompose
: null;
for (
let i = 0;
i <
prepared
.employees
.length;
i++
) {
checkStopped();
const employee =
prepared
.employees[i];
showStatus(
`Creating ${i + 1}/${batch.total}\n` +
`${employee.filename}`,
true
);
if (
!(
i === 0 &&
compose
)
) {
compose =
await openBlankCompose();
}
batch.current =
compose;
try {
await populatePayrollDraft(
compose,
subject,
employee.file
);
showStatus(
`Draft ${i + 1}/${batch.total} filled.\n` +
`${employee.filename}\n` +
`Minimizing...`,
true
);
await minimizeDraft(
compose
);
batch.completed =
i + 1;
batch.current =
null;
} catch (error) {
throw new Error(
`Stopped on ${employee.filename}: ${error.message}`
);
}
compose =
null;
await sleep(
400
);
}
showStatus(
`Done.\n` +
`${batch.completed} payroll drafts created.\n` +
`To: blank\n` +
`Cc: ${CC_ADDRESS}\n` +
`Nothing was sent.`
);
} catch (error) {
console.error(
'[Apex Gmail Helper]',
error
);
const completed =
batch
?.completed ??
0;
showStatus(
`${error.message}\n\n` +
`${completed}/${batch?.total || 0} payroll drafts completed.\n` +
`Any unfinished compose was left open.\n` +
`Nothing was sent.`
);
} finally {
batch =
null;
}
}
function choosePayrollPDF(
compose
) {
const picker =
document.createElement(
'input'
);
picker.type =
'file';
picker.accept =
'application/pdf,.pdf';
picker.style.display =
'none';
picker.addEventListener(
'change',
() => {
const file =
picker
.files?.[0];
picker.remove();
if (file) {
void runPayroll(
compose,
file
);
}
},
{
once: true
}
);
document.body.appendChild(
picker
);
picker.click();
}
function closeApexMenu() {
if (openMenu) {
openMenu.remove();
openMenu =
null;
}
}
function menuItem(
label,
callback
) {
const item =
document.createElement(
'div'
);
item.className =
'apex-helper-menu-item';
item.textContent =
label;
item.addEventListener(
'click',
event => {
event.preventDefault();
event.stopPropagation();
closeApexMenu();
callback();
}
);
return item;
}
function showApexMenu(
button,
compose
) {
closeApexMenu();
const menu =
document.createElement(
'div'
);
menu.id =
'apex-helper-menu';
const rect =
button
.getBoundingClientRect();
menu.style.left =
`${Math.max(
8,
rect.left +
rect.width / 2 -
85
)}px`;
menu.style.top =
`${rect.bottom + 5}px`;
menu.append(
menuItem(
'Invoices',
() => {
void createInvoice(
compose
).catch(
error => {
console.error(
'[Apex Gmail Helper]',
error
);
showStatus(
`Could not create invoice draft.\n${error.message}`
);
}
);
}
),
menuItem(
'Payroll',
() => {
choosePayrollPDF(
compose
);
}
)
);
menu.addEventListener(
'click',
event =>
event.stopPropagation()
);
document.body.appendChild(
menu
);
openMenu =
menu;
setTimeout(
() => {
document.addEventListener(
'click',
closeApexMenu,
{
once: true
}
);
},
0
);
}
function findNewMessageTitle(
compose
) {
const container =
composeContainer(
compose
);
return all(
container ||
compose,
'div, span'
).find(
el =>
visible(el) &&
el.childElementCount ===
0 &&
el.textContent
.trim() ===
'New Message'
);
}
function titleBarHost(
compose
) {
const title =
findNewMessageTitle(
compose
);
if (
title
?.parentElement
) {
return {
title,
host:
title.parentElement
};
}
const minimize =
minimizeButton(
compose
);
if (
minimize
?.parentElement
) {
return {
title: null,
host:
minimize
.parentElement
};
}
return {
title: null,
host: null
};
}
function installButton(
compose
) {
if (
!compose
?.isConnected
) {
return;
}
const container =
composeContainer(
compose
);
if (!container) {
return;
}
const existing =
all(
container,
'.apex-compose-button'
);
if (
existing.length >
1
) {
existing
.slice(1)
.forEach(
button =>
button.remove()
);
}
const tracked =
composeButtons.get(
compose
);
if (
tracked
?.isConnected
) {
return;
}
if (
existing[0]
?.isConnected
) {
composeButtons.set(
compose,
existing[0]
);
return;
}
const {
host
} =
titleBarHost(
compose
);
if (!host) {
return;
}
host.classList.add(
'apex-titlebar-host'
);
const button =
document.createElement(
'button'
);
button.type =
'button';
button.className =
'apex-compose-button';
button.dataset.apexHelper =
'true';
button.textContent =
'Apex ▾';
button.title =
'Apex Academy';
button.addEventListener(
'click',
event => {
event.preventDefault();
event.stopPropagation();
showApexMenu(
button,
compose
);
}
);
composeButtons.set(
compose,
button
);
host.appendChild(
button
);
}
function scan() {
for (
const compose
of composes()
) {
installButton(
compose
);
}
}
let scanPending =
false;
new MutationObserver(
() => {
if (
scanPending
) {
return;
}
scanPending =
true;
setTimeout(
() => {
scanPending =
false;
scan();
},
150
);
}
).observe(
document.body,
{
childList: true,
subtree: true
}
);
window.addEventListener(
'beforeunload',
event => {
if (!batch) {
return;
}
event.preventDefault();
event.returnValue =
'';
}
);
all(
document,
'.apex-compose-button'
).forEach(
button =>
button.remove()
);
const libs =
getPdfLibraries();
console.log(
'[Apex Gmail Helper] Loaded',
{
pdfParser:
!!libs.PDFJS_LIB,
pdfLib:
!!libs.PDFLIB
}
);
scan();
})();
}
if (location.hostname === 'calendar.google.com') {
(function () {
'use strict';
const TAG = '[Copy Reminder v4]';
const BUTTON_CLASS = 'cr4-copy-reminder';
const CUSTOM_TZ_STORAGE = 'copyReminderTimezoneAliasesV4';
const CALENDAR_TIMEZONE = 'America/Los_Angeles';
const ZOOM_URL =
'https://us02web.zoom.us/j/7145822775?pwd=CCanzZIea2F3NEILotFRpnrxti1D29.1';
const ZOOM_ID = '7145822775';
const ZOOM_PASSWORD = 'aaprep123#';
const TIMEZONE_ALIASES = {
'CA': 'America/Los_Angeles',
'CALIFORNIA': 'America/Los_Angeles',
'LOS ANGELES': 'America/Los_Angeles',
'PACIFIC': 'America/Los_Angeles',
'PACIFIC TIME': 'America/Los_Angeles',
'PT': 'America/Los_Angeles',
'PST': 'America/Los_Angeles',
'PDT': 'America/Los_Angeles',
'PR': 'America/Puerto_Rico',
'PUERTO RICO': 'America/Puerto_Rico',
'SAN JUAN': 'America/Puerto_Rico',
'AZ': 'America/Phoenix',
'ARIZONA': 'America/Phoenix',
'PHOENIX': 'America/Phoenix',
'NC': 'America/New_York',
'NORTH CAROLINA': 'America/New_York',
'ET': 'America/New_York',
'EST': 'America/New_York',
'EDT': 'America/New_York',
'EASTERN': 'America/New_York',
'EASTERN TIME': 'America/New_York',
'NEW YORK': 'America/New_York',
'CT': 'America/Chicago',
'CENTRAL': 'America/Chicago',
'CENTRAL TIME': 'America/Chicago',
'CHICAGO': 'America/Chicago',
'MT': 'America/Denver',
'MOUNTAIN': 'America/Denver',
'MOUNTAIN TIME': 'America/Denver',
'DENVER': 'America/Denver',
'UK': 'Europe/London',
'LONDON': 'Europe/London',
'JAPAN': 'Asia/Tokyo',
'TOKYO': 'Asia/Tokyo',
'JST': 'Asia/Tokyo',
'KOREA': 'Asia/Seoul',
'SEOUL': 'Asia/Seoul',
'KST': 'Asia/Seoul',
'CHINA': 'Asia/Shanghai',
'BEIJING': 'Asia/Shanghai',
'SHANGHAI': 'Asia/Shanghai',
'TAIWAN': 'Asia/Taipei',
'TAIPEI': 'Asia/Taipei',
'HONG KONG': 'Asia/Hong_Kong',
'SINGAPORE': 'Asia/Singapore',
'INDIA': 'Asia/Kolkata',
'NAIROBI': 'Africa/Nairobi',
'KENYA': 'Africa/Nairobi',
'JOHANNESBURG': 'Africa/Johannesburg',
'SOUTH AFRICA': 'Africa/Johannesburg',
'SYDNEY': 'Australia/Sydney',
'MELBOURNE': 'Australia/Melbourne'
};
function isAgendaView() {
return /\/r\/agenda(?:\/|$)/.test(location.pathname);
}
function removeAllReminderButtons() {
document
.querySelectorAll(`.${BUTTON_CLASS}`)
.forEach(el => el.remove());
}
const style = document.createElement('style');
style.textContent = `
.${BUTTON_CLASS} {
display: inline-flex !important;
align-items: center !important;
justify-content: center !important;
margin-left: 8px !important;
padding: 2px 8px !important;
height: 23px !important;
border: 1px solid #dadce0 !important;
border-radius: 12px !important;
background: #fff !important;
color: #1a73e8 !important;
font-family: Roboto, Arial, sans-serif !important;
font-size: 11px !important;
font-weight: 500 !important;
line-height: 18px !important;
cursor: pointer !important;
white-space: nowrap !important;
vertical-align: middle !important;
position: relative !important;
z-index: 1000 !important;
box-sizing: border-box !important;
user-select: none !important;
}
.${BUTTON_CLASS}:hover {
background: #f1f3f4 !important;
}
.${BUTTON_CLASS}.cr4-working {
color: #5f6368 !important;
}
.${BUTTON_CLASS}.cr4-success {
color: #137333 !important;
border-color: #81c995 !important;
}
.${BUTTON_CLASS}.cr4-error {
color: #b3261e !important;
border-color: #f28b82 !important;
}
`;
document.documentElement.appendChild(style);
const sleep = ms =>
new Promise(resolve =>
setTimeout(resolve, ms)
);
function clean(value) {
return String(value || '')
.replace(/\u00a0/g, ' ')
.replace(/\u202f/g, ' ')
.replace(/\s+/g, ' ')
.trim();
}
function visible(el) {
if (
!el ||
!(el instanceof Element)
) {
return false;
}
const css =
getComputedStyle(el);
if (
css.display === 'none' ||
css.visibility === 'hidden' ||
Number(css.opacity) === 0
) {
return false;
}
const r =
el.getBoundingClientRect();
return (
r.width > 0 &&
r.height > 0
);
}
function validTimezone(tz) {
try {
new Intl.DateTimeFormat(
'en-US',
{ timeZone: tz }
).format(new Date());
return true;
} catch {
return false;
}
}
function normalizeAlias(value) {
return clean(value)
.replace(/\s+TIME$/i, '')
.replace(/[._-]+/g, ' ')
.replace(/\s+/g, ' ')
.toUpperCase()
.trim();
}
function getSavedAliases() {
try {
return JSON.parse(
GM_getValue(
CUSTOM_TZ_STORAGE,
'{}'
)
);
} catch {
return {};
}
}
function saveAlias(
label,
timezone
) {
const aliases =
getSavedAliases();
aliases[
normalizeAlias(label)
] = timezone;
GM_setValue(
CUSTOM_TZ_STORAGE,
JSON.stringify(aliases)
);
}
function supportedTimezones() {
try {
if (
typeof Intl.supportedValuesOf ===
'function'
) {
return Intl.supportedValuesOf(
'timeZone'
);
}
} catch {}
return [];
}
function getEventID(card) {
if (!card) {
return null;
}
const direct =
card.getAttribute?.(
'data-eventid'
);
if (direct) {
return direct;
}
const child =
card.querySelector?.(
'[data-eventid]'
);
if (child) {
const id =
child.getAttribute(
'data-eventid'
);
if (id) {
return id;
}
}
for (
const link of
card.querySelectorAll?.(
'a[href*="eid="]'
) || []
) {
try {
const eid =
new URL(
link.href,
location.href
).searchParams.get(
'eid'
);
if (eid) {
return `eid:${eid}`;
}
} catch {}
}
return null;
}
function elementArea(el) {
if (!el) {
return 0;
}
const r =
el.getBoundingClientRect();
return (
r.width *
r.height
);
}
function chooseMoreSpecificElement(
a,
b
) {
if (!a) return b;
if (!b) return a;
const aa =
elementArea(a);
const ba =
elementArea(b);
if (!aa) return b;
if (!ba) return a;
return (
ba < aa
? b
: a
);
}
function hasClockTime(text) {
return /\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i
.test(
clean(text)
);
}
function getEventCards() {
if (!isAgendaView()) {
return [];
}
const main =
document.querySelector(
'[role="main"]'
) ||
document.body;
const byKey =
new Map();
function addCandidate(
el,
fallbackKey = ''
) {
if (
!el ||
!visible(el) ||
el.closest(
'[role="dialog"]'
)
) {
return;
}
const card =
el.closest(
'[data-eventid]'
) ||
el.closest(
'[role="button"]'
) ||
el;
if (
!card ||
!visible(card) ||
card.closest(
'[role="dialog"]'
)
) {
return;
}
const id =
getEventID(card);
const aria =
clean(
card.getAttribute?.(
'aria-label'
)
);
const key =
id ||
fallbackKey ||
`fallback:${aria}`;
if (!key) {
return;
}
byKey.set(
key,
chooseMoreSpecificElement(
byKey.get(key),
card
)
);
}
main
.querySelectorAll(
'[data-eventid]'
)
.forEach(
el =>
addCandidate(el)
);
main
.querySelectorAll(
'a[href*="eid="]'
)
.forEach(
el =>
addCandidate(el)
);
main
.querySelectorAll(
'[role="button"][aria-label]'
)
.forEach(el => {
const aria =
clean(
el.getAttribute(
'aria-label'
)
);
if (
!aria ||
!hasClockTime(aria)
) {
return;
}
if (
/^(today|previous|next|search|settings|help|create)\b/i
.test(aria)
) {
return;
}
const fallbackKey =
`aria:${aria}|date:${clean(
nearestDateHeading(el)
)}`;
addCandidate(
el,
fallbackKey
);
});
return [
...byKey.values()
];
}
function looksLikeOnlyTime(text) {
text =
clean(text);
return (
/^\d{1,2}(?::\d{2})?\s*(?:am|pm)$/i
.test(text) ||
/^\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s*(?:–|—|-|to)\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)$/i
.test(text)
);
}
function invalidTitleText(text) {
text =
clean(text);
if (
!text ||
looksLikeOnlyTime(text)
) {
return true;
}
if (
/^copy reminder$/i
.test(text)
) {
return true;
}
if (
/^(join|join now|google meet|zoom|accepted|declined|maybe)$/i
.test(text)
) {
return true;
}
if (
/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+/i
.test(text)
) {
return true;
}
return false;
}
function findTitleElement(card) {
const walker =
document.createTreeWalker(
card,
NodeFilter.SHOW_TEXT
);
let node;
while (
(
node =
walker.nextNode()
)
) {
const text =
clean(
node.nodeValue
);
if (
invalidTitleText(
text
) ||
text.length > 400
) {
continue;
}
const parent =
node.parentElement;
if (
!parent ||
!visible(parent)
) {
continue;
}
if (
parent.closest(
`.${BUTTON_CLASS}`
)
) {
continue;
}
return parent;
}
return null;
}
function getTitle(
card,
titleElement
) {
const direct =
clean(
titleElement
?.textContent
);
if (direct) {
return direct;
}
let aria =
clean(
card?.getAttribute?.(
'aria-label'
)
);
if (!aria) {
return '';
}
aria =
aria.replace(
/^\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s*(?:to|–|—|-)\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)\s*[,;:\-]?\s*/i,
''
);
return clean(aria);
}
function extractTimezoneInfo(
title
) {
const explicit =
title.match(
/\b(?:Africa|America|Antarctica|Arctic|Asia|Atlantic|Australia|Europe|Indian|Pacific)\/[A-Za-z0-9_+\-]+(?:\/[A-Za-z0-9_+\-]+)?\b/
);
if (
explicit &&
validTimezone(
explicit[0]
)
) {
return {
label:
explicit[0],
raw:
explicit[0],
timezone:
explicit[0]
};
}
const pieces =
title
.split(/[,;|]/)
.map(clean)
.filter(Boolean);
let timePiece =
pieces.find(
piece =>
/\bTime$/i
.test(piece)
);
if (!timePiece) {
const fallback =
title.match(
/\b([A-Za-z][A-Za-z0-9 ._/-]{0,40}\s+Time)\b/i
);
if (fallback) {
timePiece =
clean(
fallback[1]
);
}
}
if (!timePiece) {
timePiece =
'CA Time';
}
return {
label:
timePiece,
raw:
timePiece
.replace(
/\s+Time$/i,
''
)
.trim(),
timezone:
null
};
}
function autoFindIANA(label) {
const wanted =
normalizeAlias(
label
);
const matches =
supportedTimezones()
.filter(zone => {
const city =
normalizeAlias(
zone
.split('/')
.pop()
.replace(
/_/g,
' '
)
);
return (
city ===
wanted
);
});
return (
matches.length === 1
? matches[0]
: null
);
}
function resolveTimezone(info) {
if (
info.timezone &&
validTimezone(
info.timezone
)
) {
return info.timezone;
}
if (
validTimezone(
info.raw
)
) {
return info.raw;
}
const key =
normalizeAlias(
info.raw
);
if (
TIMEZONE_ALIASES[key] &&
validTimezone(
TIMEZONE_ALIASES[key]
)
) {
return (
TIMEZONE_ALIASES[
key
]
);
}
const saved =
getSavedAliases();
if (
saved[key] &&
validTimezone(
saved[key]
)
) {
return saved[key];
}
const automatic =
autoFindIANA(
info.raw
);
if (automatic) {
saveAlias(
info.raw,
automatic
);
return automatic;
}
const answer =
prompt(
`I don't know exactly which timezone "${info.label}" means.\n\n` +
`Enter an IANA timezone. I'll remember this mapping.\n\n` +
`Examples:\n` +
`America/Puerto_Rico\n` +
`Africa/Nairobi\n` +
`Africa/Johannesburg\n` +
`Europe/London`
);
if (!answer) {
return null;
}
const tz =
answer.trim();
if (
!validTimezone(tz)
) {
alert(
`"${tz}" isn't a valid IANA timezone.\n\n` +
`Example: America/Puerto_Rico`
);
return null;
}
saveAlias(
info.raw,
tz
);
return tz;
}
function decodeBase64URL(value) {
try {
let converted =
value
.replace(
/-/g,
'+'
)
.replace(
/_/g,
'/'
);
while (
converted.length %
4
) {
converted += '=';
}
return atob(
converted
);
} catch {
return '';
}
}
function parseUTCInstance(value) {
if (!value) {
return null;
}
const m =
String(value)
.match(
/_(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z\b/
);
if (!m) {
return null;
}
const d =
new Date(
`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`
);
return (
Number.isNaN(
d.getTime()
)
? null
: d
);
}
function exactStartFromCard(card) {
const ids = [];
const direct =
card.getAttribute?.(
'data-eventid'
);
if (direct) {
ids.push(
direct
);
}
card
.querySelectorAll?.(
'[data-eventid]'
)
.forEach(el => {
ids.push(
el.getAttribute(
'data-eventid'
)
);
});
for (const id of ids) {
const parsed =
parseUTCInstance(
id
);
if (parsed) {
return parsed;
}
}
for (
const link of
card.querySelectorAll?.(
'a[href*="eid="]'
) || []
) {
try {
const eid =
new URL(
link.href,
location.href
)
.searchParams
.get('eid');
if (!eid) {
continue;
}
const parsed =
parseUTCInstance(
decodeBase64URL(
eid
)
);
if (parsed) {
return parsed;
}
} catch {}
}
return null;
}
const MONTHS = {
january: 1,
february: 2,
march: 3,
april: 4,
may: 5,
june: 6,
july: 7,
august: 8,
september: 9,
october: 10,
november: 11,
december: 12
};
function parseDateText(text) {
const m =
String(text || '')
.match(
/\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:,\s*(\d{4}))?/i
);
if (!m) {
return null;
}
const month =
MONTHS[
m[1]
.toLowerCase()
];
const day =
Number(m[2]);
if (m[3]) {
return {
year:
Number(m[3]),
month,
day
};
}
const now =
new Date();
const years = [
now.getFullYear() - 1,
now.getFullYear(),
now.getFullYear() + 1
];
years.sort(
(a, b) =>
Math.abs(
Date.UTC(
a,
month - 1,
day
) -
Date.now()
) -
Math.abs(
Date.UTC(
b,
month - 1,
day
) -
Date.now()
)
);
return {
year:
years[0],
month,
day
};
}
function to24Hour(
hour,
meridiem
) {
hour =
Number(hour) %
12;
if (
String(meridiem)
.toLowerCase() ===
'pm'
) {
hour += 12;
}
return hour;
}
function parseTimeRange(text) {
text =
String(text || '')
.replace(
/\u00a0/g,
' '
)
.replace(
/\u202f/g,
' '
);
const range =
text.match(
/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:–|—|-|to)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i
);
if (range) {
const sh =
Number(
range[1]
);
const sm =
Number(
range[2] || 0
);
let sap =
range[3]
?.toLowerCase() ||
null;
const eh =
Number(
range[4]
);
const em =
Number(
range[5] || 0
);
const eap =
range[6]
.toLowerCase();
if (!sap) {
const endMins =
(
to24Hour(
eh,
eap
) * 60
) +
em;
const pmMins =
(
to24Hour(
sh,
'pm'
) * 60
) +
sm;
sap =
(
pmMins <=
endMins &&
endMins -
pmMins <=
12 * 60
)
? 'pm'
: 'am';
}
return {
start: {
hour:
to24Hour(
sh,
sap
),
minute:
sm
},
end: {
hour:
to24Hour(
eh,
eap
),
minute:
em
}
};
}
const single =
text.match(
/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i
);
if (!single) {
return null;
}
return {
start: {
hour:
to24Hour(
Number(
single[1]
),
single[3]
),
minute:
Number(
single[2] || 0
)
},
end:
null
};
}
function timezoneParts(
date,
timezone
) {
const parts =
new Intl.DateTimeFormat(
'en-US',
{
timeZone:
timezone,
year:
'numeric',
month:
'2-digit',
day:
'2-digit',
hour:
'2-digit',
minute:
'2-digit',
second:
'2-digit',
hourCycle:
'h23'
}
)
.formatToParts(
date
);
const out = {};
for (const part of parts) {
if (
part.type !==
'literal'
) {
out[
part.type
] =
Number(
part.value
);
}
}
return out;
}
function wallClockToInstant(
values,
timezone
) {
const target =
Date.UTC(
values.year,
values.month - 1,
values.day,
values.hour,
values.minute,
0
);
let timestamp =
target;
for (
let i = 0;
i < 5;
i++
) {
const actual =
timezoneParts(
new Date(
timestamp
),
timezone
);
const actualUTC =
Date.UTC(
actual.year,
actual.month - 1,
actual.day,
actual.hour,
actual.minute,
actual.second || 0
);
const diff =
actualUTC -
target;
timestamp -=
diff;
if (
Math.abs(diff) <
1000
) {
break;
}
}
return new Date(
timestamp
);
}
function nearestDateHeading(card) {
if (!card) {
return '';
}
const cardRect =
card.getBoundingClientRect();
let best = '';
let bestBottom =
-Infinity;
for (
const heading of
document.querySelectorAll(
'[role="heading"], h1, h2, h3, h4'
)
) {
if (
!visible(
heading
)
) {
continue;
}
const text =
clean(
heading.innerText ||
heading.getAttribute(
'aria-label'
)
);
if (
!parseDateText(
text
)
) {
continue;
}
const r =
heading
.getBoundingClientRect();
if (
r.bottom <=
cardRect.top +
20 &&
r.bottom >
bestBottom
) {
best =
text;
bestBottom =
r.bottom;
}
}
return best;
}
function displayedStartFromCard(
card
) {
const times =
parseTimeRange(
[
card.getAttribute?.(
'aria-label'
),
card.innerText
]
.filter(Boolean)
.join('\n')
);
const date =
parseDateText(
nearestDateHeading(
card
)
);
if (
!times ||
!date
) {
return null;
}
return wallClockToInstant(
{
...date,
...times.start
},
CALENDAR_TIMEZONE
);
}
function visibleDialogs() {
return [
...document.querySelectorAll(
'[role="dialog"]'
)
]
.filter(
visible
);
}
async function waitForEventDialog(
before,
title,
timeout = 2600
) {
const started =
Date.now();
const needle =
clean(title)
.slice(0, 30)
.toLowerCase();
while (
Date.now() -
started <
timeout
) {
const dialogs =
visibleDialogs();
for (
const dialog of
dialogs
) {
if (
!before.has(
dialog
)
) {
return dialog;
}
}
if (needle) {
for (
const dialog of
dialogs
) {
if (
clean(
dialog.innerText
)
.toLowerCase()
.includes(
needle
)
) {
return dialog;
}
}
}
await sleep(50);
}
return null;
}
async function openEventPopup(
card,
titleElement,
title
) {
const before =
new Set(
visibleDialogs()
);
try {
titleElement?.click();
} catch {}
let popup =
await waitForEventDialog(
before,
title,
1600
);
if (popup) {
return popup;
}
try {
card?.click();
} catch {}
popup =
await waitForEventDialog(
before,
title,
1000
);
return popup;
}
function closePopup(popup) {
if (!popup) {
return;
}
const close =
[
...popup.querySelectorAll(
'button, [role="button"]'
)
]
.find(el => {
const label =
clean(
[
el.getAttribute(
'aria-label'
),
el.getAttribute(
'data-tooltip'
),
el.getAttribute(
'title'
)
]
.filter(
Boolean
)
.join(' ')
);
return (
/\bclose\b/i
.test(
label
)
);
});
if (close) {
close.click();
return;
}
document.dispatchEvent(
new KeyboardEvent(
'keydown',
{
key:
'Escape',
code:
'Escape',
bubbles:
true,
cancelable:
true
}
)
);
}
function popupStart(popup) {
if (!popup) {
return null;
}
const date =
parseDateText(
popup.innerText
);
const times =
parseTimeRange(
popup.innerText
);
if (
!date ||
!times
) {
return null;
}
return wallClockToInstant(
{
...date,
...times.start
},
CALENDAR_TIMEZONE
);
}
function findMeetLink(scope) {
if (!scope) {
return null;
}
const a =
scope.querySelector?.(
'a[href*="meet.google.com/"]'
);
if (a?.href) {
return a.href;
}
const m =
String(
scope.innerText ||
''
)
.match(
/https:\/\/meet\.google\.com\/[a-z0-9-]+/i
);
return (
m
? m[0]
: null
);
}
function scrapeMeetConferenceInfo(
popup,
meetLink
) {
const lines = [
'Google Meet joining info',
`Video call link: ${meetLink}`
];
if (!popup) {
return {
text:
lines.join(
'\n'
),
complete:
false
};
}
const text =
popup.innerText ||
'';
let dialLine =
null;
const direct =
text.match(
/Or dial:\s*([^\n]+)/i
);
if (direct) {
dialLine =
clean(
direct[1]
);
} else {
const tel =
popup.querySelector(
'a[href^="tel:"]'
);
if (tel) {
const href =
decodeURIComponent(
tel.getAttribute(
'href'
) ||
''
);
let phone =
clean(
tel.textContent
);
if (
!phone ||
!/\d/.test(
phone
)
) {
phone =
href
.replace(
/^tel:/i,
''
)
.split(',')[0]
.trim();
}
if (
phone.startsWith(
'+1'
) &&
!/\(US\)/i
.test(
phone
)
) {
phone =
`(US) ${phone}`;
}
let pin =
null;
const pinText =
text.match(
/PIN:\s*([\d\s]+)#?/i
);
if (pinText) {
pin =
clean(
pinText[1]
);
}
if (!pin) {
const pinHref =
href.match(
/,+(\d{5,})#/
);
if (pinHref) {
pin =
pinHref[1];
}
}
dialLine =
pin
? `${phone} PIN: ${pin}#`
: phone;
}
}
if (dialLine) {
lines.push(
`Or dial: ${dialLine}`
);
}
const more =
[
...popup.querySelectorAll(
'a[href]'
)
]
.find(
a =>
/^https:\/\/tel\.meet\//i
.test(
a.href
)
);
if (more?.href) {
lines.push(
`More phone numbers: ${more.href}`
);
}
return {
text:
lines.join(
'\n'
),
complete:
Boolean(
dialLine &&
more?.href
)
};
}
function findGoogleCopyJoiningButton(
popup
) {
if (!popup) {
return null;
}
return [
...popup.querySelectorAll(
'button, [role="button"]'
)
]
.find(el => {
const label =
clean(
[
el.getAttribute(
'aria-label'
),
el.getAttribute(
'data-tooltip'
),
el.getAttribute(
'title'
),
el.textContent
]
.filter(
Boolean
)
.join(' ')
);
return (
/copy/i
.test(
label
) &&
/(joining|conference|meeting)/i
.test(
label
)
);
}) ||
null;
}
async function getMeetConferenceInfo(
popup,
meetLink
) {
const scraped =
scrapeMeetConferenceInfo(
popup,
meetLink
);
if (
scraped.complete
) {
return scraped.text;
}
const googleCopy =
findGoogleCopyJoiningButton(
popup
);
if (
googleCopy &&
navigator.clipboard?.readText
) {
try {
googleCopy.click();
await sleep(120);
const clipboard =
await navigator.clipboard
.readText();
const marker =
clipboard.search(
/Google Meet joining info/i
);
if (
marker !== -1 &&
clipboard.includes(
meetLink
)
) {
return (
clipboard
.slice(
marker
)
.trim()
);
}
} catch {}
}
return scraped.text;
}
function formatTime(
date,
timezone
) {
return new Intl.DateTimeFormat(
'en-US',
{
timeZone:
timezone,
hour:
'numeric',
minute:
'2-digit',
hour12:
true
}
)
.format(date)
.replace(
/\s+/g,
''
)
.toLowerCase();
}
function formatDate(
date,
timezone
) {
return new Intl.DateTimeFormat(
'en-US',
{
timeZone:
timezone,
weekday:
'long',
month:
'long',
day:
'numeric'
}
).format(date);
}
function isInPerson(title) {
return (
/##\s*IN[\s-]*PERSON\s*##/i
.test(title) ||
/\bIN[\s-]*PERSON\b/i
.test(title)
);
}
function makeInPersonMessage(
time
) {
return (
`Just a friendly reminder of your in-person session at ${time} today!`
);
}
function makeZoomMessage(
time,
timezoneLabel
) {
return (
`Just a friendly reminder of your session at ${time} ${timezoneLabel} today! \n\n` +
`${ZOOM_URL}\n` +
`Meeting ID ${ZOOM_ID}\n` +
`Meeting Password ${ZOOM_PASSWORD}`
);
}
function makeMeetMessage(
title,
start,
timezone,
conferenceInfo
) {
return (
`${title}\n` +
`${formatDate(start, timezone)} · ${formatTime(start, timezone)}\n` +
`Time zone: ${timezone}\n` +
conferenceInfo
);
}
function copyText(text) {
GM_setClipboard(
text,
'text'
);
}
function setButtonState(
button,
text,
cssClass = '',
resetAfter = 1600
) {
if (
!button?.isConnected
) {
return;
}
button.textContent =
text;
button.classList.remove(
'cr4-working',
'cr4-success',
'cr4-error'
);
if (cssClass) {
button.classList.add(
cssClass
);
}
if (resetAfter) {
setTimeout(() => {
if (
!button.isConnected
) {
return;
}
button.textContent =
'Copy reminder';
button.classList.remove(
'cr4-working',
'cr4-success',
'cr4-error'
);
}, resetAfter);
}
}
async function copyReminder(
card,
titleElement,
button
) {
if (!isAgendaView()) {
removeAllReminderButtons();
return;
}
setButtonState(
button,
'Working…',
'cr4-working',
0
);
let popup =
null;
try {
const title =
getTitle(
card,
titleElement
);
if (!title) {
throw new Error(
'Could not read the event title.'
);
}
let start =
exactStartFromCard(
card
);
if (
isInPerson(
title
)
) {
if (!start) {
start =
displayedStartFromCard(
card
);
}
if (!start) {
popup =
await openEventPopup(
card,
titleElement,
title
);
start =
popupStart(
popup
);
}
if (!start) {
throw new Error(
'Could not determine the in-person session time.'
);
}
copyText(
makeInPersonMessage(
formatTime(
start,
CALENDAR_TIMEZONE
)
)
);
setButtonState(
button,
'Copied!',
'cr4-success'
);
return;
}
const tzInfo =
extractTimezoneInfo(
title
);
const studentTimezone =
resolveTimezone(
tzInfo
);
if (!studentTimezone) {
throw new Error(
`Could not determine timezone for "${tzInfo.label}".`
);
}
popup =
await openEventPopup(
card,
titleElement,
title
);
if (!start) {
start =
popupStart(
popup
);
}
if (!start) {
start =
displayedStartFromCard(
card
);
}
if (!start) {
throw new Error(
'Could not determine the event start time.'
);
}
const meetLink =
findMeetLink(
popup
) ||
findMeetLink(
card
);
if (meetLink) {
const conferenceInfo =
await getMeetConferenceInfo(
popup,
meetLink
);
const message =
makeMeetMessage(
title,
start,
studentTimezone,
conferenceInfo
);
copyText(
message
);
}
else {
const message =
makeZoomMessage(
formatTime(
start,
studentTimezone
),
tzInfo.label
);
copyText(
message
);
}
setButtonState(
button,
'Copied!',
'cr4-success'
);
} catch (error) {
console.error(
TAG,
error
);
setButtonState(
button,
'Error',
'cr4-error',
2400
);
alert(
`Copy reminder failed:\n\n${error.message}`
);
} finally {
if (popup) {
await sleep(80);
closePopup(
popup
);
}
}
}
function hashKey(value) {
let hash = 0;
value =
String(
value || ''
);
for (
let i = 0;
i < value.length;
i++
) {
hash =
(
(
hash << 5
) -
hash +
value.charCodeAt(i)
) | 0;
}
return (
`k${Math.abs(hash)}`
);
}
function addReminderButton(card) {
if (!isAgendaView()) {
return false;
}
const titleElement =
findTitleElement(
card
);
if (!titleElement) {
return false;
}
const title =
getTitle(
card,
titleElement
);
if (!title) {
return false;
}
const eventIdentity =
getEventID(card) ||
(
`${title}|` +
`${clean(
card.getAttribute?.(
'aria-label'
)
)}|` +
`${clean(
nearestDateHeading(
card
)
)}`
);
const key =
hashKey(
eventIdentity
);
const existing = [
...document.querySelectorAll(
`.${BUTTON_CLASS}[data-cr4-key="${key}"]`
)
];
if (existing.length) {
let kept =
false;
for (
const btn of
existing
) {
if (
!kept &&
btn.isConnected
) {
kept =
true;
} else {
btn.remove();
}
}
if (kept) {
return true;
}
}
const button =
document.createElement(
'span'
);
button.className =
BUTTON_CLASS;
button.dataset.cr4Key =
key;
button.setAttribute(
'role',
'button'
);
button.setAttribute(
'tabindex',
'0'
);
button.textContent =
'Copy reminder';
for (
const eventName of
[
'pointerdown',
'mousedown'
]
) {
button.addEventListener(
eventName,
event => {
event.preventDefault();
event.stopPropagation();
event.stopImmediatePropagation();
},
true
);
}
button.addEventListener(
'click',
async event => {
event.preventDefault();
event.stopPropagation();
event.stopImmediatePropagation();
await copyReminder(
card,
titleElement,
button
);
},
true
);
button.addEventListener(
'keydown',
async event => {
if (
event.key !==
'Enter' &&
event.key !==
' '
) {
return;
}
event.preventDefault();
event.stopPropagation();
await copyReminder(
card,
titleElement,
button
);
}
);
titleElement
.insertAdjacentElement(
'afterend',
button
);
return true;
}
let scanQueued =
false;
let lastPath =
location.pathname;
function scanEvents() {
if (!isAgendaView()) {
removeAllReminderButtons();
return;
}
if (scanQueued) {
return;
}
scanQueued =
true;
setTimeout(() => {
scanQueued =
false;
if (!isAgendaView()) {
removeAllReminderButtons();
return;
}
for (
const card of
getEventCards()
) {
try {
addReminderButton(
card
);
} catch (error) {
console.warn(
`${TAG} scan error`,
error
);
}
}
}, 80);
}
function handleRouteChange() {
const currentPath =
location.pathname;
const pathChanged =
currentPath !==
lastPath;
lastPath =
currentPath;
if (!isAgendaView()) {
removeAllReminderButtons();
return;
}
if (pathChanged) {
setTimeout(
scanEvents,
100
);
setTimeout(
scanEvents,
450
);
setTimeout(
scanEvents,
1000
);
} else {
scanEvents();
}
}
const observer =
new MutationObserver(
() => {
handleRouteChange();
}
);
observer.observe(
document.documentElement,
{
childList:
true,
subtree:
true
}
);
setInterval(
handleRouteChange,
250
);
setInterval(
() => {
if (
isAgendaView()
) {
scanEvents();
} else {
removeAllReminderButtons();
}
},
2500
);
if (isAgendaView()) {
scanEvents();
setTimeout(
scanEvents,
500
);
setTimeout(
scanEvents,
1400
);
} else {
removeAllReminderButtons();
}
console.log(
`${TAG} loaded`
);
})();
}
if (location.hostname === 'calendar.google.com') {
(function () {
'use strict';
const CALENDAR_NAME_OVERRIDES = Object.freeze({
});
const STYLE_ID = 'tm-gcal-day-calendar-labels-style';
const LABEL_CLASS = 'tm-gcal-day-calendar-label';
const ANCHOR_CLASS = 'tm-gcal-day-calendar-label-anchor';
const EVENT_SELECTOR =
'[data-eventchip][data-eventid], [data-eventid][role="button"]';
const CALENDAR_CONTROL_SELECTOR =
'input[type="checkbox"][aria-label], [role="checkbox"][aria-label], [aria-checked][aria-label]';
const ACCOUNT_SELECTOR = '[aria-label^="Google Account:"]';
const POLL_MS = 2500;
const NAMES_REFRESH_MS = 30000;
const MAX_EVENT_BLOCKS = 300;
function cleanText(value) {
return String(value ?? '')
.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
.replace(/\s+/gu, ' ')
.trim();
}
function cleanCalendarName(value) {
const name = cleanText(value).replace(/^calendar\s*:\s*/i, '').trim();
return name && name.length <= 160 ? name : '';
}
function decodeBase64UrlText(value) {
const input = String(value ?? '').trim();
if (!input || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(input)) return null;
const unpadded = input.replace(/=+$/, '');
if (unpadded.length % 4 === 1) return null;
try {
const base64 = unpadded.replace(/-/g, '+').replace(/_/g, '/');
const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
const binary = atob(padded);
const bytes = Uint8Array.from(binary, character =>
character.charCodeAt(0)
);
return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
} catch {
return null;
}
}
function parseEventIdentity(encodedValue) {
const raw = String(encodedValue ?? '').trim();
if (!raw) return null;
let decoded = raw;
if (!/\s/u.test(decoded)) {
try {
decoded = decodeURIComponent(decoded);
} catch {
return null;
}
decoded = decodeBase64UrlText(decoded);
}
if (!decoded || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(decoded)) {
return null;
}
const match = decoded.match(/^(.+)\s+(\S+)$/su);
if (!match) return null;
const eventId = match[1].trim();
const calendarId = match[2].trim();
return eventId && calendarId && calendarId.length <= 2048
? { eventId, calendarId }
: null;
}
function expandCalendarId(calendarId) {
const value = cleanText(calendarId);
return value.endsWith('@m') ? `${value.slice(0, -2)}@gmail.com` : value;
}
function explicitViewFromUrl(href) {
try {
const url = new URL(String(href), 'https://calendar.google.com/');
const route = url.pathname.match(/\/r(?:\/([^/]+))?(?:\/|$)/);
if (!route) return '';
const segment = decodeURIComponent(route[1] || '').toLowerCase();
if (segment) return segment;
return cleanText(url.searchParams.get('mode')).toLowerCase();
} catch {
return '';
}
}
function isDayViewUrl(href) {
return explicitViewFromUrl(href) === 'day';
}
function escapeRegExp(value) {
return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function extractCalendarNameFromText(value, knownNames = []) {
const text = cleanText(value);
if (!text) return '';
let winner = '';
let winningPosition = -1;
const calendarField = /(?:^|,\s*)calendar\s*:\s*([^,]+)/gi;
let match;
while ((match = calendarField.exec(text))) {
const name = cleanCalendarName(match[1]);
if (name && match.index >= winningPosition) {
winner = name;
winningPosition = match.index;
}
}
for (const candidate of knownNames) {
const name = cleanCalendarName(candidate);
if (!name) continue;
const field = new RegExp(
`(?:^|,\\s*)${escapeRegExp(name)}(?=\\s*,|$)`,
'gi'
);
while ((match = field.exec(text))) {
if (match.index >= winningPosition) {
winner = name;
winningPosition = match.index;
}
}
}
return winner;
}
function lookupName(source, calendarId) {
if (!source || !calendarId) return '';
const expanded = expandCalendarId(calendarId);
for (const key of [...new Set([calendarId, expanded])]) {
const value =
source instanceof Map
? source.get(key)
: Object.prototype.hasOwnProperty.call(source, key)
? source[key]
: '';
const name = cleanCalendarName(value);
if (name) return name;
}
return '';
}
function chooseCalendarName(calendarId, sources = {}) {
return (
lookupName(sources.overrides, calendarId) ||
lookupName(sources.exact, calendarId) ||
cleanCalendarName(sources.accessible) ||
expandCalendarId(calendarId)
);
}
const TEST_API = Object.freeze({
chooseCalendarName,
explicitViewFromUrl,
extractCalendarNameFromText,
isDayViewUrl,
parseEventIdentity,
});
if (
typeof window === 'undefined' &&
typeof module === 'object' &&
module.exports
) {
module.exports = TEST_API;
return;
}
if (typeof window === 'undefined' || typeof document === 'undefined') return;
const state = {
active: false,
calendarNames: [],
exactNames: new Map(),
nextNamesRefresh: 0,
};
function hasDayViewControl() {
const controls = document.querySelectorAll(
'[aria-haspopup="menu"], button[aria-label], [role="button"][aria-label]'
);
for (const control of controls) {
if (control.closest?.(EVENT_SELECTOR)) continue;
const label = cleanText(
control.getAttribute('aria-label') || control.textContent
).toLowerCase();
if (label !== 'day') continue;
const rect = control.getBoundingClientRect?.();
if (!rect || (rect.width > 0 && rect.height > 0)) return true;
}
return false;
}
function isDayView() {
const explicitView = explicitViewFromUrl(location.href);
if (explicitView) return explicitView === 'day';
const liveView = cleanText(
document.body?.getAttribute('data-viewkey') ||
document.documentElement?.getAttribute('data-prefetch-view-key')
).toLowerCase();
return liveView ? liveView === 'day' : hasDayViewControl();
}
function refreshCalendarNames() {
const discovered = new Set(state.calendarNames);
for (const account of document.querySelectorAll(ACCOUNT_SELECTOR)) {
const label = cleanText(account.getAttribute('aria-label'));
const match = label.match(
/^Google Account:\s*(.+?)\s*\(([^()\s]+@[^()\s]+)\)\s*$/i
);
if (match) state.exactNames.set(match[2], match[1]);
}
for (const control of document.querySelectorAll(CALENDAR_CONTROL_SELECTOR)) {
if (control.closest?.(`${EVENT_SELECTOR}, [role="dialog"], [role="menu"]`)) {
continue;
}
const name = cleanCalendarName(
control.getAttribute('aria-label') ||
control.getAttribute('data-text') ||
control.getAttribute('title')
);
if (name) discovered.add(name);
}
state.calendarNames = [...discovered].sort(
(left, right) => right.length - left.length
);
state.nextNamesRefresh = Date.now() + NAMES_REFRESH_MS;
}
function directLabel(host) {
return [...host.children].find(child =>
child.classList.contains(LABEL_CLASS)
);
}
function eventAccessibleText(host) {
const chunks = [
host.getAttribute('aria-label'),
host.getAttribute('data-tooltip'),
host.getAttribute('title'),
];
for (const node of host.querySelectorAll('[aria-label]')) {
if (!node.classList.contains(LABEL_CLASS)) {
chunks.push(node.getAttribute('aria-label'));
}
}
const accessible = cleanText(chunks.filter(Boolean).join(', '));
if (accessible) return accessible;
const labelText = directLabel(host)?.textContent || '';
const visibleText = cleanText(host.textContent);
return labelText && visibleText.endsWith(labelText)
? cleanText(visibleText.slice(0, -labelText.length))
: visibleText;
}
function collectEventHosts() {
const hosts = [];
for (const candidate of document.querySelectorAll(EVENT_SELECTOR)) {
if (hosts.length >= MAX_EVENT_BLOCKS) break;
if (candidate.closest?.('[role="dialog"], [role="menu"], [role="listbox"]')) {
continue;
}
const eventKey = candidate.getAttribute('data-eventid') || '';
if (!eventKey) continue;
const parent = candidate.parentElement?.closest?.(EVENT_SELECTOR);
if (parent?.getAttribute('data-eventid') === eventKey) continue;
hosts.push(candidate);
}
return hosts;
}
function applyLabel(host) {
const encodedKey = host.getAttribute('data-eventid') || '';
const identity = parseEventIdentity(encodedKey);
if (!identity) return false;
const accessibleName = extractCalendarNameFromText(
eventAccessibleText(host),
state.calendarNames
);
const name = chooseCalendarName(identity.calendarId, {
overrides: CALENDAR_NAME_OVERRIDES,
exact: state.exactNames,
accessible: accessibleName,
});
if (!name) return false;
let label = directLabel(host);
if (!label) {
label = document.createElement('span');
label.className = LABEL_CLASS;
label.setAttribute('aria-hidden', 'true');
host.append(label);
}
if (label.textContent !== name) label.textContent = name;
if (label.dataset.eventKey !== encodedKey) label.dataset.eventKey = encodedKey;
if (
!host.classList.contains(ANCHOR_CLASS) &&
getComputedStyle(host).position === 'static'
) {
host.classList.add(ANCHOR_CLASS);
}
return true;
}
function cleanup() {
for (const label of document.querySelectorAll(`.${LABEL_CLASS}`)) {
const host = label.parentElement;
label.remove();
host?.classList.remove(ANCHOR_CLASS);
}
state.active = false;
}
function scan() {
if (document.hidden) return;
if (!isDayView()) {
if (state.active) cleanup();
return;
}
state.active = true;
if (Date.now() >= state.nextNamesRefresh) refreshCalendarNames();
const currentHosts = new Set();
for (const host of collectEventHosts()) {
if (applyLabel(host)) currentHosts.add(host);
}
for (const label of document.querySelectorAll(`.${LABEL_CLASS}`)) {
const host = label.parentElement;
if (host && currentHosts.has(host)) continue;
label.remove();
host?.classList.remove(ANCHOR_CLASS);
}
}
function safeScan() {
try {
scan();
} catch {
}
}
function installStyle() {
if (document.getElementById(STYLE_ID)) return;
const style = document.createElement('style');
style.id = STYLE_ID;
style.textContent = `
.${ANCHOR_CLASS} {
position: relative !important;
}
.${LABEL_CLASS} {
position: absolute !important;
left: 2px !important;
bottom: 1px !important;
z-index: 4 !important;
box-sizing: border-box !important;
max-width: 58% !important;
min-width: 0 !important;
padding: 0 3px !important;
overflow: hidden !important;
text-overflow: ellipsis !important;
white-space: nowrap !important;
border-radius: 3px !important;
background: rgb(0 0 0 / 28%) !important;
color: #fff !important;
font: 600 9px/11px "Google Sans", Roboto, Arial, sans-serif !important;
text-align: left !important;
opacity: .9 !important;
pointer-events: none !important;
user-select: none !important;
unicode-bidi: plaintext !important;
}
`;
document.head.append(style);
}
function initialize() {
installStyle();
safeScan();
window.setInterval(safeScan, POLL_MS);
document.addEventListener('visibilitychange', () => {
if (!document.hidden) safeScan();
});
}
if (document.body) initialize();
else window.addEventListener('DOMContentLoaded', initialize, { once: true });
})();
}
})();
