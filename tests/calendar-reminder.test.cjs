const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');

const source = readFileSync(`${__dirname}/../apex-academy-toolkit.user.js`, 'utf8');
const functions = [
    'findMeetLink', 'formatTime', 'isInPerson', 'makeInPersonMessage',
    'makeZoomMessage', 'makeMeetMessage', 'copyText', 'copyReminder'
].map(name => {
    const match = source.match(new RegExp(`^        (?:async )?function ${name}\\([\\s\\S]*?^        }`, 'm'));
    assert.ok(match, `Missing function: ${name}`);
    return match[0];
}).join('\n');

function scope(href = null, innerText = '') {
    return { innerText, querySelector: () => href ? { href } : null };
}

async function copy({ popup = null, card = scope(), title = 'Session',
    start = new Date('2026-10-15T16:30:00Z'), timezone = 'America/New_York', label = 'ET' } = {}) {
    const copied = [];
    const closed = [];
    const errors = [];
    const context = vm.createContext({
        CALENDAR_TIMEZONE: 'America/Los_Angeles', TAG: '[test]',
        ZOOM_URL: 'https://zoom.us/j/123456789', ZOOM_ID: '123456789', ZOOM_PASSWORD: 'example',
        isAgendaView: () => true, setButtonState: () => {},
        getTitle: () => title, exactStartFromCard: () => start,
        displayedStartFromCard: () => null, popupStart: () => null,
        extractTimezoneInfo: () => ({ label }), resolveTimezone: () => timezone,
        openEventPopup: async () => popup, closePopup: value => closed.push(value),
        GM_setClipboard: value => copied.push(value), sleep: async () => {},
        console: { error: () => {} }, alert: value => errors.push(value)
    });
    vm.runInContext(functions, context);
    await context.copyReminder(card, {}, {});
    assert.equal(closed.length, popup ? 1 : 0);
    return { copied, errors };
}

const meetLink = 'https://meet.google.com/abc-defg-hij';

test('Meet reminders strip everything after the meeting code', async () => {
    for (const suffix of ['?authuser=1&hs=122', '#details', '/extra?authuser=1#details']) {
        for (const event of [
            { popup: scope(meetLink + suffix) },
            { card: scope(meetLink + suffix) },
            { card: scope(null, `Join: ${meetLink}${suffix}`) }
        ]) {
            const result = await copy(event);
            assert.deepEqual(result.copied, [`Just a friendly reminder of your session today at 12:30 p.m. ET!\n\n${meetLink}`]);
            assert.deepEqual(result.errors, []);
        }
    }
});

test('Meet popup link uses the requested format and converted student time', async () => {
    const result = await copy({ popup: scope(meetLink), timezone: 'America/Los_Angeles', label: 'PT' });
    assert.deepEqual(result, {
        copied: [`Just a friendly reminder of your session today at 9:30 a.m. PT!\n\n${meetLink}`],
        errors: []
    });
});

test('Meet link in event text is used when the popup is unavailable', async () => {
    const result = await copy({ card: scope(null, `Join: ${meetLink}`) });
    assert.deepEqual(result.copied, [`Just a friendly reminder of your session today at 12:30 p.m. ET!\n\n${meetLink}`]);
    assert.deepEqual(result.errors, []);
});

test('Meet popup text takes priority over a card link', async () => {
    const result = await copy({ popup: scope(null, `Join: ${meetLink}`), card: scope('https://meet.google.com/klm-nopq-rst') });
    assert.deepEqual(result.copied, [`Just a friendly reminder of your session today at 12:30 p.m. ET!\n\n${meetLink}`]);
});

test('Zoom and in-person reminders retain their existing formats', async () => {
    const zoom = await copy();
    assert.deepEqual(zoom.copied, ['Just a friendly reminder of your session at 12:30pm ET today! \n\nhttps://zoom.us/j/123456789\nMeeting ID 123456789\nMeeting Password example']);
    const inPerson = await copy({ title: 'Session ##IN PERSON##' });
    assert.deepEqual(inPerson.copied, ['Just a friendly reminder of your in-person session at 9:30am today!']);
});

test('Missing event time reports an error without replacing the clipboard', async () => {
    const result = await copy({ popup: scope(meetLink), start: null });
    assert.deepEqual(result.copied, []);
    assert.deepEqual(result.errors, ['Copy reminder failed:\n\nCould not determine the event start time.']);
});
