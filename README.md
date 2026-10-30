# scripting

Some Google Calendar Tampermonkey scripts i've made to make some work #easier

## Apex Academy Toolkit

[Install or update the toolkit](https://raw.githubusercontent.com/alvinhhh/scripting/refs/heads/main/apex-academy-toolkit.user.js).

Calendar reminders expect the calendar's displayed timezone to be Pacific (`America/Los_Angeles`). Put the student's timezone in a comma-separated title field, for example `Student, Arizona Time, Chemistry` or `Student, America/Puerto_Rico, Chemistry`.

- `AZ`, `Arizona`, and `Phoenix` use Arizona's year-round time. Use `Navajo Nation` or `America/Denver` for a student following Navajo Nation daylight saving time.
- `PR` and `Puerto Rico` use Puerto Rico's year-round time.
- Timezone abbreviations in the generated time fields follow the event date. Pacific sessions omit the duplicate Pacific range.
- Invalid or conflicting explicit timezones, nonexistent local times, and ambiguous repeated hours stop copying and preserve the existing clipboard. A known start can resolve a repeated end time only when one possible end remains after that start.
- Starts in the repeated fall-back hour require manual confirmation even when the recurring instance ID contains a UTC timestamp, because rescheduling can leave the original instance identifier in place.
- If a recurring event's displayed start disagrees with its saved timestamp, copying stops. Confirm the event's date, time, and calendar timezone, then copy its details manually.

Run the reminder tests with `node --test tests/calendar-reminder.test.cjs`.
