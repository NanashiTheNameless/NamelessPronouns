export const EASTER_EGGS = Object.freeze([
  {
    "name": "Empty-state optimism",
    "activation": "Open a dashboard with no profiles",
    "effect": "Displays \"No profiles are available. Yet.\""
  },
  {
    "name": "Staff egg catalog",
    "activation": "Visit /admin/easter-eggs as any staff member",
    "effect": "Lists every documented Easter egg and how to activate it"
  },
  {
    "name": "Your profile shortcut",
    "activation": "Visit /u/me while signed in",
    "effect": "Redirects to your first profile, or the dashboard if you have none"
  },
  {
    "name": "Self profile",
    "activation": "Visit /u/self",
    "effect": "Redirects signed-in people like /u/me; otherwise returns \"Self not found.\""
  },
  {
    "name": "Keyboard shortcuts",
    "activation": "Press Shift + ? outside a text field",
    "effect": "Opens a panel documenting Tab, Shift+Tab, Enter, Space, arrow-key navigation, Escape, Shift+?, and the Konami code"
  },
  {
    "name": "Keyboard lap",
    "activation": "Use Tab to visit every interactive element and return to the first",
    "effect": "Says \"Full keyboard lap completed.\""
  },
  {
    "name": "Staff badge descriptions",
    "activation": "Hover over or keyboard-focus a staff badge",
    "effect": "Shows: Support \"fixes things quietly\"; Moderator \"reads everything\"; Administrator \"keeps the lights on\"; Owner \"wrote this bit\""
  },
  {
    "name": "Owner admin greeting",
    "activation": "Open Admin while signed in as Owner",
    "effect": "Says everything is somehow still running"
  },
  {
    "name": "Flag collector",
    "activation": "View a profile containing at least 11 flags",
    "effect": "Adds \"Collector.\" beneath the flags"
  },
  {
    "name": "Ultimate collector",
    "activation": "View a profile with exactly 42 flags",
    "effect": "Replaces \"Collector.\" with \"The answer, apparently.\""
  },
  {
    "name": "No-script message",
    "activation": "Disable JavaScript",
    "effect": "Shows \"No script? No problem. You are still a person.\""
  },
  {
    "name": "Offline Owner",
    "activation": "Lose connectivity while a page is open",
    "effect": "Shows a \"NamelessNanashi cannot fix your Wi-Fi.\" toast"
  },
  {
    "name": "Online encore",
    "activation": "Reconnect while a page is open",
    "effect": "Shows a \"Connection restored. NamelessNanashi accepts the credit.\" toast"
  },
  {
    "name": "Comic Sans",
    "activation": "Select the custom font and enter Comic Sans MS",
    "effect": "Says \"Bold choice. Genuinely: it helps some dyslexic readers.\""
  },
  {
    "name": "Default enthusiast",
    "activation": "Enter 0xProto as the custom font",
    "effect": "Says \"You came all this way to choose the default. Respect.\""
  },
  {
    "name": "Times New Roman",
    "activation": "Enter Times New Roman as the custom font",
    "effect": "Says \"The Times are new. The Roman is unchanged.\""
  },
  {
    "name": "Papyrus warning",
    "activation": "Enter Papyrus as the custom font",
    "effect": "Says \"The ancient records warned us.\""
  },
  {
    "name": "Coffee color",
    "activation": "Enter #c0ffee in a custom color field",
    "effect": "Says \"Coffee detected. No beans were harmed.\""
  },
  {
    "name": "Badass color",
    "activation": "Enter #bada55 in a custom color field",
    "effect": "Says \"That color has excellent credentials.\""
  },
  {
    "name": "Office color",
    "activation": "Enter #0ff1ce in a custom color field",
    "effect": "Says \"Office hours are over.\""
  },
  {
    "name": "Facade color",
    "activation": "Enter #facade in a custom color field",
    "effect": "Says \"The facade is holding up.\""
  },
  {
    "name": "Decade color",
    "activation": "Enter #decade in a custom color field",
    "effect": "Says \"A decade fits neatly into six hex digits.\""
  },
  {
    "name": "Defaced color",
    "activation": "Enter #deface in a custom color field",
    "effect": "Says \"No faces were harmed in the selection of this color.\""
  },
  {
    "name": "Ordered color",
    "activation": "Enter #123456 in a custom color field",
    "effect": "Says \"Everything appears to be in order.\""
  },
  {
    "name": "Lucky color",
    "activation": "Enter #777777 in a custom color field",
    "effect": "Says \"Seven. Naturally.\""
  },
  {
    "name": "Alphabetical color",
    "activation": "Enter #abcdef in a custom color field",
    "effect": "Says \"Alphabetical, hexadecimal, and suspiciously organized.\""
  },
  {
    "name": "Monochrome verdict",
    "activation": "Set the custom background and text colors to #000000 and #ffffff",
    "effect": "Says \"You have chosen sides.\""
  },
  {
    "name": "Same-color warning",
    "activation": "Give the custom background and text the same color",
    "effect": "Says \"Stealth mode enabled. Readability was not invited.\" while preserving the contrast warning"
  },
  {
    "name": "Double reset",
    "activation": "Press the accessibility reset button twice without changing another setting",
    "effect": "Says \"Still default. NamelessNanashi would be proud.\""
  },
  {
    "name": "Backup backup",
    "activation": "Copy accessibility settings three times consecutively",
    "effect": "Says \"Backup of backup complete.\""
  },
  {
    "name": "Settings time machine",
    "activation": "Import accessibility settings with \"version\": 1998",
    "effect": "Unlocks and applies the 1998 theme"
  },
  {
    "name": "Theme tourist",
    "activation": "Try all four standard themes in one browser session",
    "effect": "Says \"You have seen all our possible selves.\""
  },
  {
    "name": "Print escape",
    "activation": "Print a profile",
    "effect": "Adds \"This profile escaped the internet.\" only to the printed page"
  },
  {
    "name": "Owner print signature",
    "activation": "Print the Owner's profile",
    "effect": "Adds approval for its escape by NamelessNanashi"
  },
  {
    "name": "Null profile",
    "activation": "Visit /u/null",
    "effect": "Shows Null's fully written joke profile about intentionally having no value"
  },
  {
    "name": "Undefined profile",
    "activation": "Visit /u/undefined",
    "effect": "Shows Undefined's fully written joke profile about never being assigned a value"
  },
  {
    "name": "Anonymous profile",
    "activation": "Visit /u/anonymous",
    "effect": "Shows Anonymous's fully written, deliberately unidentifiable joke profile"
  },
  {
    "name": "Everyone profile",
    "activation": "Visit /u/everyone",
    "effect": "Shows a collective profile with they/them, we/us, and you/all jokes"
  },
  {
    "name": "Nobody profile",
    "activation": "Visit /u/nobody",
    "effect": "Shows Nobody's suspiciously detailed profile and deliberately unhelpful pronouns"
  },
  {
    "name": "Epoch profile",
    "activation": "Visit /u/epoch",
    "effect": "Shows a profile that has been waiting since the Unix timestamp was zero"
  },
  {
    "name": "Not a Name",
    "activation": "Visit /u/nan",
    "effect": "Shows NaN, short for \"Not a Name,\" with not/a/name pronouns"
  },
  {
    "name": "Localhost profile",
    "activation": "Visit /u/localhost",
    "effect": "Insists there is no place like 127.0.0.1"
  },
  {
    "name": "True profile",
    "activation": "Visit /u/true",
    "effect": "Shows True's fully written joke profile agreeing with itself"
  },
  {
    "name": "False profile",
    "activation": "Visit /u/false",
    "effect": "Shows False's fully written joke profile disputing its own claims"
  },
  {
    "name": "Root profile",
    "activation": "Visit /u/root",
    "effect": "Shows a fully written superuser profile whose pronouns require elevated privileges"
  },
  {
    "name": "Void profile",
    "activation": "Visit /u/void",
    "effect": "Shows a fully written profile that contains nothing and has excellent boundaries"
  },
  {
    "name": "Infinity profile",
    "activation": "Visit /u/infinity",
    "effect": "Shows a profile that never quite finishes introducing itself, with on/and/on pronouns"
  },
  {
    "name": "Profile deja vu",
    "activation": "Visit the same reserved profile seven times in one browser session",
    "effect": "Says \"You two have met before.\""
  },
  {
    "name": "Avatar inspection",
    "activation": "Activate a reserved profile's avatar seven times",
    "effect": "Briefly mirrors it and says \"Identity check inconclusive.\""
  },
  {
    "name": "Footer persistence",
    "activation": "Click NamelessNanashi in the footer seven times",
    "effect": "Temporarily changes it to \"Still NamelessNanashi\" and shows a \"NamelessNanashi remains operational.\" toast"
  },
  {
    "name": "Leap-day visitor",
    "activation": "Visit on February 29",
    "effect": "Adds \"This message appears approximately once every four years.\" to the footer"
  },
  {
    "name": "Epoch birthday",
    "activation": "Visit on January 1",
    "effect": "Adds \"Epoch says happy birthday.\" to the footer"
  },
  {
    "name": "Owner profile title",
    "activation": "Click the heading on the Owner's profile seven times",
    "effect": "Temporarily changes it to \"Yes, this is the Owner.\" and shows a \"Yes, this is still the Owner.\" toast"
  },
  {
    "name": "Owner badge encore",
    "activation": "Hover or focus the Owner badge five times",
    "effect": "Changes its tooltip to \"still wrote this bit\""
  },
  {
    "name": "Admin sudo",
    "activation": "Enter sudo in the admin account lookup",
    "effect": "Responds \"Nice try. This is not a shell.\""
  },
  {
    "name": "Admin root",
    "activation": "Enter root in the admin account lookup",
    "effect": "Responds \"Wrong tree.\""
  },
  {
    "name": "Admin SQL",
    "activation": "Enter select * in the admin account lookup",
    "effect": "Responds \"Please step away from the database.\""
  },
  {
    "name": "Shortcut inception",
    "activation": "Press Shift + ? while the shortcuts panel is open",
    "effect": "Temporarily changes its heading to \"You are already here.\""
  },
  {
    "name": "Name sequence",
    "activation": "Type nanashi outside a text field",
    "effect": "Shows an Owner-located toast with a 3-5 business-eternity response time"
  },
  {
    "name": "Forty-two shortcut",
    "activation": "Type 42 outside a text field",
    "effect": "Shows a toast saying the answer was found but the question remains unavailable"
  },
  {
    "name": "Who am I?",
    "activation": "Type whoami outside a text field",
    "effect": "Shows an \"An easter egg collector, Apparently.\" toast"
  },
  {
    "name": "Help command",
    "activation": "Type help outside a text field",
    "effect": "Shows a \"Shift+? was right there.\" toast"
  },
  {
    "name": "Konami theme",
    "activation": "Enter Up Up Down Down Left Right Left Right B A outside a text field",
    "effect": "Permanently unlocks the accessible \"1998\" theme and shows a toast"
  },
  {
    "name": "Konami encore",
    "activation": "Enter the Konami code after unlocking the theme",
    "effect": "Shows an \"Achievement already achieved.\" toast"
  },
  {
    "name": "Konami attribution",
    "activation": "Unlock the 1998 theme",
    "effect": "Credits its preservation to NamelessNanashi"
  },
  {
    "name": "Intentional 404",
    "activation": "Visit /404",
    "effect": "Returns a real HTTP 404 saying \"Congratulations. You found it.\""
  },
  {
    "name": "Owner 404",
    "activation": "Visit /404?owner",
    "effect": "Asks that the found page be returned to NamelessNanashi"
  },
  {
    "name": "Persistent 404 recovery",
    "activation": "Return home from /404 three times",
    "effect": "Says \"The missing page was safely returned. Repeatedly.\" only after the third return"
  },
  {
    "name": "Teapot",
    "activation": "Visit /teapot",
    "effect": "Returns HTTP 418 with \"I'm a teapot. It/its, thanks.\""
  },
  {
    "name": "Wrong appliance",
    "activation": "Visit /teapot?coffee",
    "effect": "Returns HTTP 406 with \"Wrong appliance.\""
  },
  {
    "name": "Patient teapot",
    "activation": "Revisit /teapot after at least 4 minutes and 18 seconds",
    "effect": "Returns \"Properly steeped\" with X-Tea-Steeped: precisely"
  },
  {
    "name": "Nothing endpoint",
    "activation": "Visit /nothing",
    "effect": "Returns HTTP 204 No Content with X-Nothing: successfully-returned"
  },
  {
    "name": "Something in nothing",
    "activation": "Visit /nothing?something=true",
    "effect": "Returns HTTP 409 with \"That defeats the purpose.\""
  },
  {
    "name": "Nothing encore",
    "activation": "Visit /nothing?again",
    "effect": "Returns nothing again with X-Nothing-Again: yes"
  },
  {
    "name": "Humans file",
    "activation": "Visit /humans.txt",
    "effect": "Credits the humans behind NamelessPronouns"
  },
  {
    "name": "Pronouns file",
    "activation": "Visit /pronouns.txt",
    "effect": "Returns a plain-text identity card ending with \"This file uses it/its.\""
  },
  {
    "name": "Robots comment",
    "activation": "Visit /robots.txt",
    "effect": "Displays \"Crawl if you like. You may not remember this place.\""
  },
  {
    "name": "Robots annotation",
    "activation": "Inspect /robots.txt",
    "effect": "Reveals that Nanashi was there and the crawler saw nothing"
  },
  {
    "name": "Well-known identity",
    "activation": "Visit /.well-known/nameless",
    "effect": "Returns JSON containing name: null, pronouns: any/all, and owner: NamelessNanashi"
  },
  {
    "name": "Headless tea",
    "activation": "Send HEAD /teapot",
    "effect": "Returns HTTP 418 with an empty body and X-Tea: omitted"
  },
  {
    "name": "Pronoun response header",
    "activation": "Inspect a profile page's HTTP headers",
    "effect": "Adds X-Pronouns with the profile's first pronoun pair"
  },
  {
    "name": "Semantic human credit",
    "activation": "Inspect the response headers",
    "effect": "Adds Link: </humans.txt>; rel=\"author\""
  },
  {
    "name": "Nanashi header",
    "activation": "Inspect any response's headers",
    "effect": "Adds X-Nanashi: was-here"
  },
  {
    "name": "Curl acknowledgement",
    "activation": "Request any page using curl",
    "effect": "Adds X-Curl: excellent-choice without logging the request"
  },
  {
    "name": "Owner status header",
    "activation": "Inspect the Owner profile response",
    "effect": "Adds X-Owner-Status: probably-debugging"
  },
  {
    "name": "Nothing attribution",
    "activation": "Visit /nothing and inspect its headers",
    "effect": "Adds X-Nothing-By: NamelessNanashi"
  },
  {
    "name": "Teapot proprietor",
    "activation": "Inspect /teapot headers",
    "effect": "Adds X-Tea-Made-By: NamelessNanashi"
  },
  {
    "name": "View-source note",
    "activation": "View any page's source",
    "effect": "Reveals <!-- You found the source. It uses it/its. -->"
  },
  {
    "name": "Owner source signature",
    "activation": "View page source",
    "effect": "Reveals a reluctant signature from NamelessNanashi"
  },
  {
    "name": "Console greeting",
    "activation": "Open the browser developer tools",
    "effect": "Prints NamelessPronouns, Achievement Get: Read the console!"
  },
  {
    "name": "Console business card",
    "activation": "Enter NamelessNanashi in the developer console",
    "effect": "Returns a frozen Owner object whose status is \"probably debugging\""
  },
  {
    "name": "Empty console argument",
    "activation": "Run NamelessNanashi.toString() in the console",
    "effect": "Returns [Owner probably debugging]"
  },
  {
    "name": "Owner diagnostics",
    "activation": "Run NamelessNanashi.fix() in the console",
    "effect": "Returns \"Have you tried turning it off and on again?\""
  }
].map(Object.freeze));
