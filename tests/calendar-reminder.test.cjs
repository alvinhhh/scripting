const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');

const source = readFileSync(`${__dirname}/../apex-academy-toolkit.user.js`, 'utf8');
const functions = [
    'to24Hour', 'parseTimeRange', 'timezoneParts', 'wallClockToInstant',
    'meetEndFromEvent', 'findMeetLink', 'formatTime', 'formatDate', 'isInPerson',
    'makeInPersonMessage', 'makeZoomMessage', 'makeMeetMessage', 'copyText', 'copyReminder'
].map(name => {
    const match = source.match(new RegExp(`^        (?:async )?function ${name}\\([\\s\\S]*?^        }`, 'm'));
    assert.ok(match, `Missing function: ${name}`);
    return match[0];
}).join('\n');

function scope(href = null, innerText = '', ariaLabel = '') {
    return {
        innerText,
        querySelector: () => href ? { href } : null,
        getAttribute: name => name === 'aria-label' ? ariaLabel : null
    };
}

const meetLink = 'https://meet.google.com/abc-defg-hij';
const phoneInfo = 'Or dial: +1 202-555-0100 PIN: 123 456 789#';
const conferenceInfo = link => `Google Meet joining info\nVideo call link: ${link}\n${phoneInfo}\nMore phone numbers: https://tel.meet/abc-defg-hij?pin=123456789&hs=1`;
const title = 'Demo Session (Puerto Rico Time)';
const existingClipboard = 'Existing clipboard text';

async function copy({ popup = null, card = scope(), eventTitle = title,
    start = new Date('2026-07-15T23:00:00Z'), timezone = 'America/Puerto_Rico', label = 'Puerto Rico Time' } = {}) {
    const copied = [];
    const closed = [];
    const errors = [];
    const conferenceCalls = [];
    let clipboard = existingClipboard;
    const context = vm.createContext({
        CALENDAR_TIMEZONE: 'America/Los_Angeles', TAG: '[test]',
        ZOOM_URL: 'https://zoom.us/j/123456789', ZOOM_ID: '123456789', ZOOM_PASSWORD: 'example',
        isAgendaView: () => true, setButtonState: () => {},
        getTitle: () => eventTitle, exactStartFromCard: () => start,
        displayedStartFromCard: () => null, popupStart: () => null,
        extractTimezoneInfo: () => ({ label }), resolveTimezone: () => timezone,
        openEventPopup: async () => popup, closePopup: value => closed.push(value),
        getMeetConferenceInfo: async (value, link) => {
            conferenceCalls.push({ popup: value, link });
            return conferenceInfo(link);
        },
        GM_setClipboard: value => { copied.push(value); clipboard = value; },
        sleep: async () => {}, console: { error: () => {} }, alert: value => errors.push(value)
    });
    vm.runInContext(functions, context);
    await context.copyReminder(card, {}, {});
    assert.equal(closed.length, popup ? 1 : 0);
    return { copied, errors, clipboard, conferenceCalls };
}

function expectedMessage(dateAndTimes, link = meetLink) {
    return `${title}\n${dateAndTimes}\nTime zone: America/Puerto_Rico\n${conferenceInfo(link)}`;
}

const summerLine = 'Wednesday, July 15 · 7:00pm - 8:00pm (4:00pm - 5:00pm PST)';

test('Meet invitation includes both ranges and preserves the conference information', async () => {
    const eventTitle = 'Demo Student, North Carolina Time (EST), Counseling';
    const link = `${meetLink}?authuser=1&hs=122`;
    const result = await copy({
        eventTitle, start: new Date('2026-10-23T23:00:00Z'), timezone: 'America/New_York',
        popup: scope(link, 'Friday, October 23\n4 – 5pm')
    });
    assert.deepEqual(result.copied, [
        `${eventTitle}\nFriday, October 23 · 7:00pm - 8:00pm (4:00pm - 5:00pm PST)\nTime zone: America/New_York\n${conferenceInfo(link)}`
    ]);
    assert.deepEqual(result.errors, []);
    assert.equal(result.conferenceCalls.length, 1);
});

test('Pacific conversion follows summer and winter offsets while retaining the requested PST label', async () => {
    const result = await copy({
        start: new Date('2026-12-16T00:00:00Z'),
        popup: scope(meetLink, 'Tuesday, December 15\n4:00pm - 5:00pm')
    });
    assert.deepEqual(result.copied, [expectedMessage('Tuesday, December 15 · 8:00pm - 9:00pm (4:00pm - 5:00pm PST)')]);
    assert.deepEqual(result.errors, []);
});

test('Pacific sessions omit the repeated range in summer and winter', async () => {
    for (const eventTitle of ['Demo Student, CA Time', 'Demo Student, Nevada Time']) {
        for (const [start, day] of [
            ['2026-07-15T23:00:00Z', 'Wednesday, July 15'],
            ['2026-12-16T00:00:00Z', 'Tuesday, December 15']
        ]) {
            const result = await copy({
                eventTitle, start: new Date(start), timezone: 'America/Los_Angeles',
                popup: scope(meetLink, '4pm - 5pm')
            });
            assert.deepEqual(result.copied, [
                `${eventTitle}\n${day} · 4:00pm - 5:00pm\nTime zone: America/Los_Angeles\n${conferenceInfo(meetLink)}`
            ]);
            assert.deepEqual(result.errors, []);
        }
    }
});

test('Equivalent Pacific timezone aliases also omit the repeated range', async () => {
    const result = await copy({ timezone: 'US/Pacific', popup: scope(meetLink, '4pm - 5pm') });
    assert.deepEqual(result.copied, [
        `${title}\nWednesday, July 15 · 4:00pm - 5:00pm\nTime zone: US/Pacific\n${conferenceInfo(meetLink)}`
    ]);
    assert.deepEqual(result.errors, []);
});

test('Meet anchor links keep query parameters, fragments, and paths', async () => {
    for (const suffix of ['?authuser=1&hs=122', '#details', '/extra?authuser=1#details']) {
        for (const event of [
            { popup: scope(meetLink + suffix, '4pm - 5pm') },
            { card: scope(meetLink + suffix, '4pm - 5pm') }
        ]) {
            const result = await copy(event);
            assert.deepEqual(result.copied, [expectedMessage(summerLine, meetLink + suffix)]);
            assert.deepEqual(result.errors, []);
        }
    }
});

test('Text Meet links retain the baseline bare-URL fallback', async () => {
    const result = await copy({ card: scope(null, `4pm - 5pm\nJoin: ${meetLink}?authuser=1`) });
    assert.deepEqual(result.copied, [expectedMessage(summerLine)]);
    assert.deepEqual(result.errors, []);
});

test('Popup range takes priority and card aria-label precedes card text', async () => {
    for (const event of [
        { popup: scope(meetLink, '4pm - 5pm'), card: scope(null, '4pm - 7pm', '4pm - 6pm') },
        { popup: scope(meetLink, '4pm'), card: scope(null, '4pm - 6pm', '4pm - 5pm') },
        { popup: scope(meetLink, '4pm'), card: scope(null, '4pm - 5pm', '4pm') },
        { card: scope(meetLink, '', '4pm - 5pm') }
    ]) {
        const result = await copy(event);
        assert.deepEqual(result.copied, [expectedMessage(summerLine)]);
        assert.deepEqual(result.errors, []);
    }
});

test('End time crosses midnight and the year boundary', async () => {
    const result = await copy({
        start: new Date('2027-01-01T07:30:00Z'),
        popup: scope(meetLink, '11:30pm - 12:30am')
    });
    assert.deepEqual(result.copied, [expectedMessage('Friday, January 1 · 3:30am - 4:30am (11:30pm - 12:30am PST)')]);
    assert.deepEqual(result.errors, []);
});

test('Student date follows the converted start date', async () => {
    const result = await copy({
        popup: scope(meetLink, '4pm - 5pm'), timezone: 'Asia/Manila'
    });
    assert.deepEqual(result.copied, [
        `${title}\nThursday, July 16 · 7:00am - 8:00am (4:00pm - 5:00pm PST)\nTime zone: Asia/Manila\n${conferenceInfo(meetLink)}`
    ]);
    assert.deepEqual(result.errors, []);
});

test('Missing end reports an error without changing the clipboard or fetching conference details', async () => {
    for (const text of ['', '4pm']) {
        const result = await copy({ popup: scope(meetLink, text), card: scope(null, '4pm') });
        assert.deepEqual(result.copied, []);
        assert.equal(result.clipboard, existingClipboard);
        assert.deepEqual(result.conferenceCalls, []);
        assert.deepEqual(result.errors, ['Copy reminder failed:\n\nCould not determine the event end time.']);
    }
});

test('Zoom and in-person reminders retain their existing formats', async () => {
    const zoom = await copy();
    assert.deepEqual(zoom.copied, ['Just a friendly reminder of your session at 7:00pm Puerto Rico Time today! \n\nhttps://zoom.us/j/123456789\nMeeting ID 123456789\nMeeting Password example']);
    assert.deepEqual(zoom.errors, []);
    const inPerson = await copy({ eventTitle: 'Demo Session ##IN PERSON##' });
    assert.deepEqual(inPerson.copied, ['Just a friendly reminder of your in-person session at 4:00pm today!']);
    assert.deepEqual(inPerson.errors, []);
});

test('Missing start reports an error without replacing the clipboard', async () => {
    const result = await copy({ popup: scope(meetLink, '4pm - 5pm'), start: null });
    assert.deepEqual(result.copied, []);
    assert.equal(result.clipboard, existingClipboard);
    assert.deepEqual(result.errors, ['Copy reminder failed:\n\nCould not determine the event start time.']);
});
