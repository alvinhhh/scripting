const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');

const source = readFileSync(`${__dirname}/../apex-academy-toolkit.user.js`, 'utf8');
const months = source.match(/^        const MONTHS = \{[\s\S]*?^        };/m);
assert.ok(months, 'Missing month names');
const functions = months[0] + '\n' + [
    'parseDateText', 'to24Hour', 'parseTimeRange', 'timezoneParts', 'wallClockToInstant',
    'validateEventStart', 'meetEndFromEvent', 'findMeetLink', 'formatTime', 'formatDate', 'isInPerson',
    'timezoneLabel', 'makeInPersonMessage', 'makeZoomMessage', 'makeMeetMessage', 'copyText', 'copyReminder'
].map(name => {
    const match = source.match(new RegExp(`^        (?:async )?function ${name}\\([\\s\\S]*?^        }`, 'm'));
    assert.ok(match, `Missing function: ${name}`);
    return match[0];
}).join('\n');

const timezoneAliases = source.match(/^        const TIMEZONE_ALIASES = \{[\s\S]*?^        };/m);
assert.ok(timezoneAliases, 'Missing timezone aliases');
const timezoneFunctions = timezoneAliases[0] + '\n' + [
    'clean', 'validTimezone', 'normalizeAlias', 'getSavedAliases', 'saveAlias',
    'supportedTimezones', 'extractTimezoneInfo', 'autoFindIANA', 'resolveTimezone'
].map(name => {
    const match = source.match(new RegExp(`^        function ${name}\\([\\s\\S]*?^        }`, 'm'));
    assert.ok(match, `Missing timezone function: ${name}`);
    return match[0];
}).join('\n');

function timezoneGlobals(savedAliases = {}) {
    return {
        CUSTOM_TZ_STORAGE: 'test-timezones',
        GM_getValue: () => JSON.stringify(savedAliases),
        GM_setValue: () => {},
        prompt: () => { throw new Error('Unexpected timezone prompt'); }
    };
}

function resolveTitle(eventTitle, savedAliases = {}) {
    const context = vm.createContext(timezoneGlobals(savedAliases));
    vm.runInContext(timezoneFunctions, context);
    const info = context.extractTimezoneInfo(eventTitle);
    return { label: info.label, timezone: context.resolveTimezone(info) };
}

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
    start = new Date('2026-07-15T23:00:00Z'), timezone = 'America/Puerto_Rico', label = 'Puerto Rico Time', realTimezone = false, savedAliases = {} } = {}) {
    const copied = [];
    const closed = [];
    const errors = [];
    const conferenceCalls = [];
    let clipboard = existingClipboard;
    const context = vm.createContext({
        ...timezoneGlobals(savedAliases),
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
    if (realTimezone) vm.runInContext(timezoneFunctions, context);
    await context.copyReminder(card, {}, {});
    assert.equal(closed.length, popup ? 1 : 0);
    return { copied, errors, clipboard, conferenceCalls };
}

function expectedMessage(dateAndTimes, link = meetLink) {
    return `${title}\n${dateAndTimes}\nTime zone: America/Puerto_Rico\n${conferenceInfo(link)}`;
}

const summerLine = 'Wednesday, July 15 · 7:00pm - 8:00pm (4:00pm - 5:00pm PDT)';

test('Meet invitation includes both ranges and preserves the conference information', async () => {
    const eventTitle = 'Demo Student, North Carolina Time (EST), Counseling';
    const link = `${meetLink}?authuser=1&hs=122`;
    const result = await copy({
        eventTitle, start: new Date('2026-10-23T23:00:00Z'), timezone: 'America/New_York',
        popup: scope(link, 'Friday, October 23\n4 – 5pm')
    });
    assert.deepEqual(result.copied, [
        `${eventTitle}\nFriday, October 23 · 7:00pm - 8:00pm (4:00pm - 5:00pm PDT)\nTime zone: America/New_York\n${conferenceInfo(link)}`
    ]);
    assert.deepEqual(result.errors, []);
    assert.equal(result.conferenceCalls.length, 1);
});

test('Pacific conversion uses the winter PST label', async () => {
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
        `${title}\nThursday, July 16 · 7:00am - 8:00am (4:00pm - 5:00pm PDT)\nTime zone: Asia/Manila\n${conferenceInfo(meetLink)}`
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

test('New York labels without Time resolve to daylight-aware Eastern time', () => {
    for (const label of ['NY EST', 'NY', 'EST', 'North Carolina EST', 'NC (EST)', 'North Carolina Time (EST)']) {
        assert.deepEqual(resolveTitle(`Demo Student, ${label}, Chemistry`), {
            label, timezone: 'America/New_York'
        });
    }
});

test('All US timezone aliases use regional summer and winter rules', () => {
    const dates = [new Date('2026-07-15T22:30:00Z'), new Date('2026-12-15T23:30:00Z')];
    const zones = [
        [['NY', 'NEW YORK', 'NC', 'NORTH CAROLINA', 'EASTERN', 'ET', 'EST', 'EDT'], 'America/New_York', ['6:30pm', '6:30pm']],
        [['CENTRAL', 'CT', 'CST', 'CDT'], 'America/Chicago', ['5:30pm', '5:30pm']],
        [['MOUNTAIN', 'MT', 'MST', 'MDT'], 'America/Denver', ['4:30pm', '4:30pm']],
        [['CA', 'CALIFORNIA', 'PACIFIC', 'PT', 'PST', 'PDT'], 'America/Los_Angeles', ['3:30pm', '3:30pm']],
        [['AZ', 'ARIZONA'], 'America/Phoenix', ['3:30pm', '4:30pm']],
        [['AK', 'ALASKA', 'AKT', 'AKST', 'AKDT'], 'America/Anchorage', ['2:30pm', '2:30pm']],
        [['HI', 'HAWAII', 'HST'], 'Pacific/Honolulu', ['12:30pm', '1:30pm']],
        [['ALEUTIAN', 'HAWAII-ALEUTIAN', 'HAST', 'HADT', 'HDT'], 'America/Adak', ['1:30pm', '1:30pm']],
        [['PR', 'PUERTO RICO', 'ATLANTIC', 'AT', 'AST'], 'America/Puerto_Rico', ['6:30pm', '7:30pm']],
        [['CHST', 'CHAMORRO', 'GUAM'], 'Pacific/Guam', ['8:30am', '9:30am']],
        [['AS', 'SST', 'AMERICAN SAMOA'], 'Pacific/Pago_Pago', ['11:30am', '12:30pm']]
    ];
    for (const [labels, timezone, times] of zones) {
        for (const label of labels) {
            const resolved = resolveTitle(`Demo Student, ${label}, Chemistry`);
            assert.equal(resolved.timezone, timezone, label);
            dates.forEach((date, i) => {
                const time = new Intl.DateTimeFormat('en-US', {
                    timeZone: resolved.timezone, hour: 'numeric', minute: '2-digit', hour12: true
                }).format(date).replace(/\s+/g, '').toLowerCase();
                assert.equal(time, times[i], `${label} ${date.toISOString()}`);
            });
        }
    }
});

test('Timezone detection preserves defaults, international labels, IANA zones, and saved aliases', () => {
    for (const eventTitle of ['Demo Student, Chemistry', 'Demo Student, CA Time, Chemistry', 'India, CA Time, Chemistry', 'India, Chemistry', 'Demo Student, History of New York', 'Demo Student, Japan Math']) {
        assert.equal(resolveTitle(eventTitle).timezone, 'America/Los_Angeles', eventTitle);
    }
    for (const [label, timezone] of [
        ['Puerto Rico Time', 'America/Puerto_Rico'], ['Japan Time', 'Asia/Tokyo'],
        ['North Carolina Time', 'America/New_York'], ['Europe/London', 'Europe/London'],
        ['(NY EST)', 'America/New_York'], ['Pacific Time (PST)', 'America/Los_Angeles']
    ]) {
        assert.equal(resolveTitle(`Demo Student, ${label}, Chemistry`).timezone, timezone, label);
    }
    assert.equal(resolveTitle('Demo Student, Nevada Time, Chemistry', { NEVADA: 'America/Los_Angeles' }).timezone, 'America/Los_Angeles');
    assert.equal(resolveTitle('Demo Student, Custom Coast, Chemistry', { 'CUSTOM COAST': 'America/New_York' }).timezone, 'America/New_York');
});

test('Real NY EST extraction copies the correct full Zoom reminder in summer and winter', async () => {
    for (const [start, abbreviation] of [['2026-10-23T22:30:00Z', 'EDT'], ['2026-12-15T23:30:00Z', 'EST']]) {
        const result = await copy({
            eventTitle: 'Demo Student, NY EST, Chemistry', start: new Date(start), realTimezone: true
        });
        assert.deepEqual(result.copied, [`Just a friendly reminder of your session at 6:30pm NY ${abbreviation} today! \n\nhttps://zoom.us/j/123456789\nMeeting ID 123456789\nMeeting Password example`]);
        assert.deepEqual(result.errors, []);
    }
});

test('Real timezone resolution reaches Meet formatting and Pacific duplicate suppression', async () => {
    for (const [zoneLabel, timezone, line] of [
        ['NY EST', 'America/New_York', '6:30pm - 8:30pm (3:30pm - 5:30pm PDT)'],
        ['CA', 'America/Los_Angeles', '3:30pm - 5:30pm'],
        ['Nevada Time', 'America/Los_Angeles', '3:30pm - 5:30pm']
    ]) {
        const eventTitle = `Demo Student, ${zoneLabel}, Chemistry`;
        const result = await copy({
            eventTitle, start: new Date('2026-10-23T22:30:00Z'), realTimezone: true,
            savedAliases: { NEVADA: 'America/Los_Angeles' }, popup: scope(meetLink, '3:30pm - 5:30pm')
        });
        assert.deepEqual(result.copied, [
            `${eventTitle}\nFriday, October 23 · ${line}\nTime zone: ${timezone}\n${conferenceInfo(meetLink)}`
        ]);
        assert.deepEqual(result.errors, []);
    }
});

function timeContext() {
    const context = vm.createContext({ CALENDAR_TIMEZONE: 'America/Los_Angeles' });
    vm.runInContext(functions, context);
    return context;
}

function wallTime(month, day, hour, minute = 0) {
    return { year: 2026, month, day, hour, minute };
}

test('Arizona and Puerto Rico keep fixed offsets across the Pacific fall DST change', async () => {
    for (const [zoneLabel, timezone, before, after] of [
        ['AZ MST Time', 'America/Phoenix', '4:00pm - 5:00pm', '5:00pm - 6:00pm'],
        ['PR EST Time', 'America/Puerto_Rico', '7:00pm - 8:00pm', '8:00pm - 9:00pm']
    ]) {
        const eventTitle = `Demo Student, ${zoneLabel}, Chemistry`;
        for (const [start, day, range, pacificAbbreviation] of [
            ['2026-10-31T23:00:00Z', 'Saturday, October 31', before, 'PDT'],
            ['2026-11-02T00:00:00Z', 'Sunday, November 1', after, 'PST']
        ]) {
            const result = await copy({ eventTitle, start: new Date(start), realTimezone: true,
                popup: scope(meetLink, '4pm - 5pm') });
            assert.deepEqual(result.copied, [
                `${eventTitle}\n${day} · ${range} (4:00pm - 5:00pm ${pacificAbbreviation})\nTime zone: ${timezone}\n${conferenceInfo(meetLink)}`
            ]);
            assert.deepEqual(result.errors, []);
        }
    }
});

test('Timezone parsing preserves regional exceptions in abbreviation and Time title forms', () => {
    for (const [timezone, labels] of [
        ['America/Phoenix', ['AZ MST Time', 'Arizona MST Time', 'AZ Time (MST)', 'Arizona Time (MDT)', 'AZ MST']],
        ['America/Puerto_Rico', ['PR EST Time', 'Puerto Rico EST Time', 'PR Time (EST)', 'Puerto Rico Time (EDT)', 'PR EST']],
        ['America/Denver', ['Navajo Nation', 'Navajo Time', 'Navajo Nation Time']]
    ]) {
        for (const label of labels) {
            assert.equal(resolveTitle(`Demo Student, ${label}, Chemistry`).timezone, timezone, label);
        }
    }
});

test('Explicit IANA zones resolve case-insensitively including Etc zones', () => {
    for (const [label, expected] of [
        ['America/Phoenix', 'America/Phoenix'], ['america/phoenix', 'America/Phoenix'],
        ['america/puerto_rico', 'America/Puerto_Rico'], ['europe/london', 'Europe/London'],
        ['Etc/UTC', 'UTC'], ['etc/utc', 'UTC']
    ]) {
        const resolved = resolveTitle(`Demo Student, ${label}, Chemistry`);
        const canonical = new Intl.DateTimeFormat('en-US', { timeZone: resolved.timezone }).resolvedOptions().timeZone;
        assert.equal(canonical, expected, label);
    }
});

test('Malformed explicit timezone tokens fail without copying a Pacific default', async () => {
    for (const label of ['America/Not_A_Zone', 'america/not_a_zone', 'Etc/Not_A_Zone']) {
        const result = await copy({ eventTitle: `Demo Student, ${label}, Chemistry`, realTimezone: true });
        assert.deepEqual(result.copied, [], label);
        assert.equal(result.clipboard, existingClipboard, label);
        assert.equal(result.errors.length, 1, label);
        assert.deepEqual(result.conferenceCalls, [], label);
    }
});

test('Zoom labels use date-specific abbreviations while preserving the regional wording', async () => {
    for (const [label, rendered] of [
        ['Eastern Time (EST)', 'Eastern Time (EDT)'],
        ['AZ MDT Time', 'AZ MST Time'],
        ['PR EST Time', 'PR AST Time']
    ]) {
        const result = await copy({ eventTitle: `Demo Student, ${label}, Chemistry`, realTimezone: true,
            start: new Date('2026-10-31T23:00:00Z') });
        const time = label.startsWith('AZ') ? '4:00pm' : '7:00pm';
        assert.deepEqual(result.copied, [
            `Just a friendly reminder of your session at ${time} ${rendered} today! \n\nhttps://zoom.us/j/123456789\nMeeting ID 123456789\nMeeting Password example`
        ]);
        assert.deepEqual(result.errors, []);
    }
});

test('Wall-clock conversion rejects nonexistent and repeated local times', () => {
    const context = timeContext();
    assert.throws(() => context.wallClockToInstant(wallTime(3, 8, 2, 30), 'America/Los_Angeles'));
    assert.throws(() => context.wallClockToInstant(wallTime(11, 1, 1, 30), 'America/Los_Angeles'));
    assert.equal(context.wallClockToInstant(wallTime(3, 8, 3, 30), 'America/Los_Angeles').toISOString(), '2026-03-08T10:30:00.000Z');
    assert.equal(context.wallClockToInstant(wallTime(11, 1, 2, 30), 'America/Los_Angeles').toISOString(), '2026-11-01T10:30:00.000Z');
});

test('Known start constrains repeated-hour ends without inventing an overnight event', () => {
    const context = timeContext();
    const timezone = 'America/Los_Angeles';
    const repeated = wallTime(11, 1, 1, 30);
    assert.throws(() => context.wallClockToInstant(repeated, timezone, new Date('2026-11-01T07:30:00Z')));
    assert.equal(context.wallClockToInstant(repeated, timezone, new Date('2026-11-01T08:45:00Z')).toISOString(), '2026-11-01T09:30:00.000Z');
    assert.equal(context.wallClockToInstant(repeated, timezone, new Date('2026-11-01T09:30:00Z')), null);
    assert.throws(() => context.wallClockToInstant(wallTime(3, 8, 2, 30), timezone, new Date('2026-03-08T09:30:00Z')));
});

test('Meet ends follow exact starts in either fall-back occurrence and across the repeated hour', () => {
    const context = timeContext();
    for (const start of ['2026-11-01T08:15:00Z', '2026-11-01T09:15:00Z']) {
        const end = context.meetEndFromEvent(new Date(start), scope(meetLink, '1:15am - 2:15am'), scope());
        assert.equal(end.toISOString(), '2026-11-01T10:15:00.000Z');
    }
    assert.equal(context.meetEndFromEvent(new Date('2026-11-01T08:45:00Z'),
        scope(meetLink, '1:45am - 1:15am'), scope()).toISOString(), '2026-11-01T09:15:00.000Z');
    assert.equal(context.meetEndFromEvent(new Date('2026-11-01T09:15:00Z'),
        scope(meetLink, '1:15am - 1:45am'), scope()).toISOString(), '2026-11-01T09:45:00.000Z');
});

test('Uncertain DST ends leave clipboard and conference details untouched', async () => {
    for (const [start, range] of [
        ['2026-03-08T09:30:00Z', '1:30am - 2:30am'],
        ['2026-11-01T07:30:00Z', '12:30am - 1:30am'],
        ['2026-11-01T08:15:00Z', '1:15am - 1:45am']
    ]) {
        const result = await copy({ start: new Date(start), popup: scope(meetLink, range) });
        assert.deepEqual(result.copied, [], range);
        assert.equal(result.clipboard, existingClipboard, range);
        assert.deepEqual(result.conferenceCalls, [], range);
        assert.equal(result.errors.length, 1, range);
    }
});

test('Overnight ends use the next date when the earlier same-day wall time was in a spring gap', async () => {
    const result = await copy({ start: new Date('2026-03-09T06:00:00Z'),
        popup: scope(meetLink, '11pm - 2:30am') });
    assert.deepEqual(result.copied, [expectedMessage('Monday, March 9 · 2:00am - 5:30am (11:00pm - 2:30am PDT)')]);
    assert.deepEqual(result.errors, []);
});

test('An overnight end that falls in the next day spring gap does not copy', async () => {
    const result = await copy({ start: new Date('2026-03-08T07:00:00Z'),
        popup: scope(meetLink, '11pm - 2:30am') });
    assert.deepEqual(result.copied, []);
    assert.equal(result.clipboard, existingClipboard);
    assert.deepEqual(result.conferenceCalls, []);
    assert.equal(result.errors.length, 1);
});

test('Meet fall-back ranges label both Pacific offsets including Pacific-only invitations', async () => {
    for (const [eventTitle, timezone, expectedLine] of [
        ['Demo Student, PR Time', 'America/Puerto_Rico', 'Sunday, November 1 · 3:30am - 6:15am (12:30am PDT - 2:15am PST)'],
        ['Demo Student, CA Time', 'America/Los_Angeles', 'Sunday, November 1 · 12:30am PDT - 2:15am PST']
    ]) {
        const result = await copy({ eventTitle, timezone, realTimezone: true,
            start: new Date('2026-11-01T07:30:00Z'), popup: scope(meetLink, '12:30am - 2:15am') });
        assert.deepEqual(result.copied, [`${eventTitle}\n${expectedLine}\nTime zone: ${timezone}\n${conferenceInfo(meetLink)}`]);
        assert.deepEqual(result.errors, []);
    }
});

test('Wall-clock conversion handles the Lord Howe half-hour fold and spring gap', () => {
    const context = timeContext();
    const timezone = 'Australia/Lord_Howe';
    const repeated = wallTime(4, 5, 1, 45);
    const first = new Date('2026-04-04T14:45:00Z');
    const second = new Date('2026-04-04T15:15:00Z');
    for (const candidate of [first, second]) {
        const parts = context.timezoneParts(candidate, timezone);
        assert.equal(parts.month, 4);
        assert.equal(parts.day, 5);
        assert.equal(parts.hour, 1);
        assert.equal(parts.minute, 45);
    }
    assert.throws(() => context.wallClockToInstant(repeated, timezone));
    assert.equal(context.wallClockToInstant(repeated, timezone, first).toISOString(), second.toISOString());
    assert.equal(context.wallClockToInstant(repeated, timezone, second), null);
    assert.throws(() => context.wallClockToInstant(wallTime(10, 4, 2, 15), timezone));
    assert.equal(context.wallClockToInstant(wallTime(10, 4, 2, 30), timezone).toISOString(), '2026-10-03T15:30:00.000Z');
});

test('Stale recurring start hours and dates do not replace the clipboard', async () => {
    for (const [start, visible] of [
        ['2026-11-01T23:00:00Z', 'Sunday, November 1, 2026\n4pm - 5pm'],
        ['2026-11-02T00:00:00Z', 'Monday, November 2, 2026\n4pm - 5pm']
    ]) {
        const result = await copy({ start: new Date(start), popup: scope(meetLink, visible) });
        assert.deepEqual(result.copied, []);
        assert.equal(result.clipboard, existingClipboard);
        assert.deepEqual(result.conferenceCalls, []);
        assert.equal(result.errors.length, 1);
    }
});

test('In-person reminders reject start metadata that disagrees with the visible card', async () => {
    const result = await copy({ eventTitle: 'Demo Session ##IN PERSON##',
        start: new Date('2026-11-01T23:00:00Z'), card: scope(null, '', 'Sunday, November 1, 2026, 4pm - 5pm') });
    assert.deepEqual(result.copied, []);
    assert.equal(result.clipboard, existingClipboard);
    assert.equal(result.errors.length, 1);
});

test('A visible date and time consistent with the exact start can be copied', async () => {
    const result = await copy({ start: new Date('2026-11-02T00:00:00Z'),
        popup: scope(meetLink, 'Sunday, November 1, 2026\n4pm - 5pm') });
    assert.deepEqual(result.copied, [expectedMessage('Sunday, November 1 · 8:00pm - 9:00pm (4:00pm - 5:00pm PST)')]);
    assert.deepEqual(result.errors, []);
});

test('Conflicting explicit IANA zones fail while equivalent case aliases remain valid', async () => {
    const rejected = await copy({ eventTitle: 'Demo Student, America/Phoenix / America/Denver, Chemistry', realTimezone: true });
    assert.deepEqual(rejected.copied, []);
    assert.equal(rejected.clipboard, existingClipboard);
    assert.equal(rejected.errors.length, 1);
    assert.deepEqual(rejected.conferenceCalls, []);
    const resolved = resolveTitle('Demo Student, america/phoenix / America/Phoenix, Chemistry');
    const canonical = new Intl.DateTimeFormat('en-US', { timeZone: resolved.timezone }).resolvedOptions().timeZone;
    assert.equal(canonical, 'America/Phoenix');
});

test('Full reminder copies reject either occurrence of a repeated local start', async () => {
    for (const start of ['2026-11-01T08:30:00Z', '2026-11-01T09:30:00Z']) {
        const result = await copy({ start: new Date(start),
            popup: scope(meetLink, 'Sunday, November 1, 2026\n1:30am - 2:30am') });
        assert.deepEqual(result.copied, [], start);
        assert.equal(result.clipboard, existingClipboard, start);
        assert.deepEqual(result.conferenceCalls, [], start);
        assert.equal(result.errors.length, 1, start);
    }
});

test('A stale recurring first-occurrence timestamp cannot validate an identical second-fold display', async () => {
    const visible = 'Sunday, November 1, 2026\n1:30am - 2:30am';
    const result = await copy({ start: new Date('2026-11-01T08:30:00Z'),
        popup: scope(meetLink, visible), card: scope(null, visible, visible), realTimezone: true });
    assert.deepEqual(result.copied, []);
    assert.equal(result.clipboard, existingClipboard);
    assert.deepEqual(result.conferenceCalls, []);
    assert.equal(result.errors.length, 1);
});
