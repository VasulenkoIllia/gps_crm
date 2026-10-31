import dayjs from "dayjs";
import "dayjs/locale/uk";
import timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";

// Dates of the system are Kyiv dates, whatever the device's zone: 05-ui-standard.md
const APP_TIME_ZONE = "Europe/Kyiv";

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.tz.setDefault(APP_TIME_ZONE);
dayjs.locale("uk");
