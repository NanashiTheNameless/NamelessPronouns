export const EASTER_EGGS = Object.freeze([
  {
    "name": "Empty-state optimism",
    "activation": "Open a dashboard with no profiles",
    "effect": "Displays \"No profiles are available. Yet.\""
  },
  {
    "name": "Flag collector",
    "activation": "View a profile containing at least 11 flags",
    "effect": "Adds \"Collector.\" beneath the flags"
  },
  {
    "name": "Confident no",
    "activation": "View a profile whose pronoun sets are all marked \"Nope\", with at least two sets",
    "effect": "Adds \"A confident no. Respected.\" beneath the pronouns"
  },
  {
    "name": "Entirely jokingly",
    "activation": "View a profile whose pronoun sets are all marked \"Jokingly\", with at least two sets",
    "effect": "Adds \"Nothing here is serious. Including this line.\" beneath the pronouns"
  },
  {
    "name": "Placeholder prose",
    "activation": "Type lorem ipsum into a profile bio or notes field",
    "effect": "Says \"Placeholder detected. You are allowed to be real.\""
  },
  {
    "name": "Classic password",
    "activation": "Submit Password@123 as a new password",
    "effect": "Adds \"Bold, classic, and already in every list.\" to the common-password refusal"
  },
  {
    "name": "Leetspeak classic",
    "activation": "Submit g00dPa$$w0rD as a new password",
    "effect": "Adds \"Leetspeak fools no one. Also in the list.\" to the common-password refusal"
  },
  {
    "name": "Nobody signs up",
    "activation": "Request an account using nobody@example.com",
    "effect": "Answers \"Nobody already has a profile. See /u/nobody.\""
  },
  {
    "name": "Export ownership",
    "activation": "Download your account data",
    "effect": "The export metadata records owned_by: you"
  },
  {
    "name": "Patient rate limit",
    "activation": "Reach any rate limit",
    "effect": "Adds X-Patience: required to every 429, and ends the message with \"Slow down. The pronouns are not going anywhere.\" on the ones that render an error page"
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
    "name": "No-script message",
    "activation": "Disable JavaScript",
    "effect": "Shows \"No script? No problem. You are still a person.\""
  },
  {
    "name": "Late-night visit",
    "activation": "Open any page between 02:00 and 04:00 by the device clock",
    "effect": "Shows a \"Go to sleep. The profile will still be here tomorrow.\" toast, once per browser session"
  },
  {
    "name": "Epoch birthday",
    "activation": "Visit on January 1",
    "effect": "Adds \"Epoch says happy birthday.\" to the footer"
  },
  {
    "name": "Pi Day",
    "activation": "Visit on March 14",
    "effect": "Adds \"Approximately 3.14 people are reading this.\" to the footer"
  },
  {
    "name": "April first",
    "activation": "Visit on April 1",
    "effect": "Adds \"Everything here is true, except False.\" to the footer"
  },
  {
    "name": "Day of Visibility",
    "activation": "Visit on March 31",
    "effect": "Adds \"Transgender Day of Visibility. You are seen, and you are welcome here.\" to the footer"
  },
  {
    "name": "Day of Remembrance",
    "activation": "Visit on November 20",
    "effect": "Adds \"Transgender Day of Remembrance. We remember the names, and the people who chose them.\" to the footer, written plainly rather than as a joke"
  },
  {
    "name": "Leap-day visitor",
    "activation": "Visit on February 29",
    "effect": "Adds \"This message appears approximately once every four years.\" to the footer"
  },
  {
    "name": "Owner admin greeting",
    "activation": "Open Admin while signed in as Owner",
    "effect": "Says everything is somehow still running"
  },
  {
    "name": "Staff badge descriptions",
    "activation": "Hover over or keyboard-focus a staff badge",
    "effect": "Shows: Support \"fixes things quietly\"; Moderator \"reads everything\"; Administrator \"keeps the lights on\"; Owner \"wrote this bit\""
  },
  {
    "name": "Quiet queue",
    "activation": "Open the content flag reviews with none pending",
    "effect": "Adds \"Nothing to moderate. Suspicious.\""
  },
  {
    "name": "Staff egg catalog",
    "activation": "Visit /admin/easter-eggs as any staff member",
    "effect": "Lists every documented Easter egg and how to activate it"
  },
  {
    "name": "Admin Nanashi",
    "activation": "Enter nanashi in the admin account lookup",
    "effect": "Responds \"That account is looking back.\""
  },
  {
    "name": "Admin placeholders",
    "activation": "Enter null or undefined in the admin account lookup",
    "effect": "Responds \"Both already have profiles. See /u/null and /u/undefined.\""
  },
  {
    "name": "Admin root",
    "activation": "Enter root in the admin account lookup",
    "effect": "Responds \"Wrong tree.\""
  },
  {
    "name": "Admin sudo",
    "activation": "Enter sudo in the admin account lookup",
    "effect": "Responds \"Nice try. This is not a shell.\""
  },
  {
    "name": "Admin SQL",
    "activation": "Enter select * in the admin account lookup",
    "effect": "Responds \"Please step away from the database.\""
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
    "name": "Backward keyboard lap",
    "activation": "Use Shift+Tab to visit every interactive element and return to the first",
    "effect": "Says \"Keyboard lap completed in reverse.\""
  },
  {
    "name": "Shortcut inception",
    "activation": "Press Shift + ? while the shortcuts panel is open",
    "effect": "Temporarily changes its heading to \"You are already here.\""
  },
  {
    "name": "Default enthusiast",
    "activation": "Enter 0xProto as the custom font",
    "effect": "Says \"You came all this way to choose the default. Respect.\""
  },
  {
    "name": "Comic Sans",
    "activation": "Select the custom font and enter Comic Sans MS",
    "effect": "Says \"Bold choice. Genuinely: it helps some dyslexic readers.\""
  },
  {
    "name": "Times New Roman",
    "activation": "Enter Times New Roman as the custom font",
    "effect": "Says \"The Times are new. The Roman is unchanged.\""
  },
  {
    "name": "Helvetica",
    "activation": "Enter Helvetica as the custom font",
    "effect": "Says \"There is a documentary about this.\""
  },
  {
    "name": "Papyrus warning",
    "activation": "Enter Papyrus as the custom font",
    "effect": "Says \"The ancient records warned us.\""
  },
  {
    "name": "Wingdings",
    "activation": "Enter Wingdings as the custom font",
    "effect": "Says \"We cannot read that either.\""
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
    "name": "Decoded color",
    "activation": "Enter #dec0de in a custom color field",
    "effect": "Says \"Decoded.\""
  },
  {
    "name": "Office color",
    "activation": "Enter #0ff1ce in a custom color field",
    "effect": "Says \"Office hours are over.\""
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
    "name": "Theme tourist",
    "activation": "Try all four standard themes in one browser session",
    "effect": "Says \"You have seen all our possible selves.\""
  },
  {
    "name": "Settings time machine",
    "activation": "Import an accessibility settings object with \"version\": 1998, even if its theme is \"default\"",
    "effect": "Unlocks the 1998 theme in that browser until its site data is cleared, while continuing to use the theme selected by the imported settings"
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
    "name": "Nobody print line",
    "activation": "Print /u/nobody",
    "effect": "Adds \"Nobody printed this.\" only to the printed page"
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
    "name": "Nanashi shortcut",
    "activation": "Visit /u/nanashi",
    "effect": "Redirects to the Owner's own profile at /u/NamelessNanashi"
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
    "name": "Not a Name",
    "activation": "Visit /u/nan",
    "effect": "Shows NaN, short for \"Not a Name,\" with not/a/name pronouns"
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
    "name": "Epoch profile",
    "activation": "Visit /u/epoch",
    "effect": "Shows a profile that has been waiting since the Unix timestamp was zero"
  },
  {
    "name": "Localhost profile",
    "activation": "Visit /u/localhost",
    "effect": "Insists there is no place like 127.0.0.1"
  },
  {
    "name": "Root profile",
    "activation": "Visit /u/root",
    "effect": "Shows a fully written superuser profile whose pronouns require elevated privileges"
  },
  {
    "name": "Anonymous profile",
    "activation": "Visit /u/anonymous",
    "effect": "Shows Anonymous's fully written, deliberately unidentifiable joke profile"
  },
  {
    "name": "Someone profile",
    "activation": "Visit /u/someone",
    "effect": "Shows Someone insisting they were definitely here while witnesses disagree"
  },
  {
    "name": "Something profile",
    "activation": "Visit /u/something",
    "effect": "Shows Something formally disputing the claim that the site contains Nothing"
  },
  {
    "name": "Unknown profile",
    "activation": "Visit /u/unknown",
    "effect": "Shows a complete profile whose identity remains under investigation"
  },
  {
    "name": "Else profile",
    "activation": "Visit /u/else",
    "effect": "Shows a profile that appears because every prior condition was false"
  },
  {
    "name": "Everyone profile",
    "activation": "Visit /u/everyone",
    "effect": "Shows a collective profile with they/them, we/us, and you/all jokes"
  },
  {
    "name": "Everything profile",
    "activation": "Visit /u/everything",
    "effect": "Shows a fully written profile containing all of the above and several things not invented yet"
  },
  {
    "name": "Nobody profile",
    "activation": "Visit /u/nobody",
    "effect": "Shows Nobody's suspiciously detailed profile and deliberately unhelpful pronouns"
  },
  {
    "name": "Nothing profile",
    "activation": "Visit /u/nothing",
    "effect": "Shows Nothing's conspicuously present profile and complicates several definitions"
  },
  {
    "name": "Staff profile",
    "activation": "Visit /u/staff",
    "effect": "Shows Staff as a collective noun wearing a badge, with we/us listed jokingly"
  },
  {
    "name": "Owner profile",
    "activation": "Visit /u/owner",
    "effect": "Shows the Owner role rather than the person holding it, status probably debugging"
  },
  {
    "name": "Titles are not people",
    "activation": "Visit /u/admin, /u/administrator, /u/moderator, or /u/support",
    "effect": "Returns HTTP 404 with \"Titles are not people.\""
  },
  {
    "name": "Recursive 404",
    "activation": "Visit /u/404",
    "effect": "Returns HTTP 404 with \"Recursion detected.\""
  },
  {
    "name": "Alternate profile URLs",
    "activation": "Visit /@nobody or /user/nobody, in any capitalisation",
    "effect": "Redirects to /u/nobody, so every reserved profile answers the same URL shapes a real profile does"
  },
  {
    "name": "Profile deja vu",
    "activation": "Visit the same profile seven times in one browser session",
    "effect": "Says \"You two have met before.\""
  },
  {
    "name": "Avatar inspection",
    "activation": "Activate any profile's avatar seven times without reloading",
    "effect": "Briefly mirrors it and says \"Identity check inconclusive.\""
  },
  {
    "name": "Footer persistence",
    "activation": "Click NamelessNanashi in the footer seven times",
    "effect": "Temporarily changes the line to \"Still Operated by NamelessNanashi.\" and shows a \"NamelessNanashi keeps working on this site.\" toast"
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
    "name": "Infinity encore",
    "activation": "Remain on /u/infinity for 60 seconds",
    "effect": "Says \"Still going.\""
  },
  {
    "name": "Help command",
    "activation": "Type help outside a text field",
    "effect": "Shows a \"Shift+? was right there.\" toast"
  },
  {
    "name": "Who am I?",
    "activation": "Type whoami outside a text field",
    "effect": "Shows an \"An easter egg collector, Apparently.\" toast"
  },
  {
    "name": "Pronouns sequence",
    "activation": "Type pronouns outside a text field",
    "effect": "Says \"Correct. You found the subject.\""
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
    "name": "XYZZY",
    "activation": "Type xyzzy outside a text field",
    "effect": "Says \"Nothing happens. Documented.\""
  },
  {
    "name": "Konami theme",
    "activation": "Enter Up Up Down Down Left Right Left Right B A outside a text field",
    "effect": "Unlocks the accessible \"1998\" theme in that browser until its site data is cleared, and shows a toast"
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
    "name": "Error dimensions",
    "activation": "Resize the viewport to exactly 404 by 418 pixels",
    "effect": "Says \"Not found, but properly steeped.\""
  },
  {
    "name": "Status endpoint",
    "activation": "Visit /status",
    "effect": "Returns \"Somehow still running.\""
  },
  {
    "name": "Humans file",
    "activation": "Visit /humans.txt",
    "effect": "Credits the humans behind NamelessPronouns"
  },
  {
    "name": "Robots comment",
    "activation": "Visit /robots.txt",
    "effect": "Disallows every crawler and says \"Please do not crawl. You would not remember this place anyway.\""
  },
  {
    "name": "Robots annotation",
    "activation": "Inspect /robots.txt",
    "effect": "Reveals that Nanashi was there and the crawler saw nothing"
  },
  {
    "name": "Ads file",
    "activation": "Visit /ads.txt",
    "effect": "Returns \"No advertisements are available. Yet is not implied.\""
  },
  {
    "name": "Pronouns file",
    "activation": "Visit /pronouns.txt",
    "effect": "Returns a plain-text identity card ending with \"This file uses it/its.\""
  },
  {
    "name": "Security contact",
    "activation": "Visit /.well-known/security.txt",
    "effect": "Returns a real RFC 9116 contact file ending with \"Nanashi reads these. Eventually.\""
  },
  {
    "name": "Well-known identity",
    "activation": "Visit /.well-known/nameless",
    "effect": "Returns JSON containing name: null, pronouns: any/all, and owner: NamelessNanashi"
  },
  {
    "name": "No algorithm",
    "activation": "Visit /algorithm",
    "effect": "Returns HTTP 404 with \"No algorithm lives here. You choose what to read.\""
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
    "activation": "Return home from /404 three times in the same browser within one hour",
    "effect": "Counts returns in localStorage and says \"The missing page was safely returned. Repeatedly.\" only after the third return"
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
    "name": "Coffee endpoint",
    "activation": "Visit /coffee",
    "effect": "Returns HTTP 418 with \"Wrong appliance. Other direction.\" and a Link header pointing at /teapot"
  },
  {
    "name": "Patient teapot",
    "activation": "Revisit /teapot in the same browser between 4 minutes 18 seconds and one hour later",
    "effect": "Returns \"Properly steeped\" with X-Tea-Steeped: precisely"
  },
  {
    "name": "Teapot options",
    "activation": "Send OPTIONS /teapot",
    "effect": "Returns Allow: GET, HEAD, OPTIONS and X-Brew: not-standardized"
  },
  {
    "name": "Headless tea",
    "activation": "Send HEAD /teapot",
    "effect": "Returns HTTP 418 with an empty body and X-Tea: omitted"
  },
  {
    "name": "Nothing endpoint",
    "activation": "Visit /nothing",
    "effect": "Returns HTTP 204 No Content with X-Nothing: successfully-returned"
  },
  {
    "name": "Nothing encore",
    "activation": "Visit /nothing?again",
    "effect": "Returns nothing again with X-Nothing-Again: yes"
  },
  {
    "name": "Something in nothing",
    "activation": "Visit /nothing?something=true",
    "effect": "Returns HTTP 409 with \"That defeats the purpose.\""
  },
  {
    "name": "Headless nothing",
    "activation": "Send HEAD /nothing",
    "effect": "Returns an empty response with X-Head: nothing-to-see"
  },
  {
    "name": "Fast nothing",
    "activation": "Send HEAD /nothing",
    "effect": "Adds X-Nothing-Speed: optimal"
  },
  {
    "name": "Powered by",
    "activation": "Inspect any response's headers",
    "effect": "Adds X-Powered-By: caffeine-and-spite"
  },
  {
    "name": "Nanashi header",
    "activation": "Inspect any response's headers",
    "effect": "Adds X-Nanashi: was-here"
  },
  {
    "name": "Semantic human credit",
    "activation": "Inspect the response headers",
    "effect": "Adds Link: </humans.txt>; rel=\"author\""
  },
  {
    "name": "Pronoun response header",
    "activation": "Inspect a profile page's HTTP headers",
    "effect": "Adds X-Pronouns with the profile's first pronoun pair"
  },
  {
    "name": "Teapot adjacent",
    "activation": "Inspect the headers of a profile that lists it/its",
    "effect": "Adds X-Teapot-Adjacent: yes"
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
    "name": "Curl acknowledgement",
    "activation": "Request any page using curl",
    "effect": "Adds X-Curl: excellent-choice without logging the request"
  },
  {
    "name": "Text browser respect",
    "activation": "Request any page using Lynx, w3m, Links, or ELinks",
    "effect": "Adds X-Text-Browser: respect"
  },
  {
    "name": "Do Not Track",
    "activation": "Send DNT: 1",
    "effect": "Adds X-Tracking: was-never-here"
  },
  {
    "name": "Global privacy",
    "activation": "Send Sec-GPC: 1",
    "effect": "Adds X-Privacy-Preference: acknowledged"
  },
  {
    "name": "View-source note",
    "activation": "View any HTML page's source",
    "effect": "Reveals <!-- You found the source. It uses it/its. -->"
  },
  {
    "name": "Owner source signature",
    "activation": "View any HTML page's source",
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
    "name": "Console pronouns",
    "activation": "Run NamelessNanashi.pronouns in the console",
    "effect": "Returns they/them"
  },
  {
    "name": "Console help",
    "activation": "Run NamelessNanashi.help() in the console",
    "effect": "Returns \"Shift+? was right there.\""
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
