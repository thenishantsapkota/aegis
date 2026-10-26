// Simple marks for brands that Simple Icons no longer carries. Each is drawn
// from basic shapes and lettering in the brand's colours, on the same 24x24
// grid as the Simple Icons logos, so it reads as the service at 20px without
// reproducing the official artwork.
//
// Lettering uses the app font; the marks sit on the dark icon tile, so the
// neutral parts use light grey to match how dark brand logos are drawn there.

const FONT = "Geist Variable, system-ui, sans-serif";
const LIGHT = "rgb(228 228 231)";

export type CustomMark = {
  title: string;
  /** Extra names this mark matches, besides its title. */
  aliases: string[];
  Mark: () => JSX.Element;
};

// The orange arrow-smile shared by the Amazon and AWS marks.
function Smile({ y }: { y: number }) {
  return (
    <g fill="none" stroke="#FF9900" strokeWidth={1.8} strokeLinecap="round">
      <path d={`M4.5 ${y} Q12 ${y + 4.5} 19.5 ${y}`} />
      <path d={`M17.2 ${y - 0.6} L19.7 ${y - 0.2} L19.2 ${y + 2.2}`} />
    </g>
  );
}

export const CUSTOM_MARKS: CustomMark[] = [
  {
    title: "Microsoft",
    aliases: [
      "microsoftaccount",
      "microsoft365",
      "office365",
      "outlook",
      "hotmail",
      "windowslive",
      "msn",
      "azure",
      "teams",
    ],
    Mark: () => (
      <>
        <rect x="2" y="2" width="9.5" height="9.5" fill="#F25022" />
        <rect x="12.5" y="2" width="9.5" height="9.5" fill="#7FBA00" />
        <rect x="2" y="12.5" width="9.5" height="9.5" fill="#00A4EF" />
        <rect x="12.5" y="12.5" width="9.5" height="9.5" fill="#FFB900" />
      </>
    ),
  },
  {
    title: "Xbox",
    aliases: ["xboxlive", "xboxnetwork"],
    Mark: () => (
      <>
        <circle cx="12" cy="12" r="10.5" fill="#107C10" />
        <path
          d="M7.5 6.5 Q12 10 16.5 17.5 M16.5 6.5 Q12 10 7.5 17.5"
          fill="none"
          stroke="#fff"
          strokeWidth={2.2}
          strokeLinecap="round"
        />
      </>
    ),
  },
  {
    title: "LinkedIn",
    aliases: [],
    Mark: () => (
      <>
        <rect x="2" y="2" width="20" height="20" rx="3.5" fill="#0A66C2" />
        <text
          x="12.3"
          y="17"
          textAnchor="middle"
          fontFamily={FONT}
          fontSize="12.5"
          fontWeight="700"
          fill="#fff"
        >
          in
        </text>
      </>
    ),
  },
  {
    title: "Yahoo",
    aliases: ["yahoomail"],
    Mark: () => (
      <text
        x="12"
        y="18"
        textAnchor="middle"
        fontFamily={FONT}
        fontSize="16"
        fontWeight="800"
        fill="#7B3FF2"
      >
        Y!
      </text>
    ),
  },
  {
    title: "Adobe",
    aliases: ["adobeid", "adobecreativecloud", "creativecloud"],
    Mark: () => (
      <g fill="#FA0F00">
        <path d="M2 3h7.2L2 21z" />
        <path d="M22 3h-7.2L22 21z" />
        <path d="M12 9.2 16.6 21h-3.1l-1.3-3.4H9z" />
      </g>
    ),
  },
  {
    title: "Nintendo",
    aliases: ["nintendoaccount", "nintendoswitch", "nintendoeshop"],
    Mark: () => (
      <>
        <rect
          x="1"
          y="5.5"
          width="22"
          height="13"
          rx="6.5"
          fill="none"
          stroke="#E60012"
          strokeWidth={1.6}
        />
        <text
          x="12"
          y="16.3"
          textAnchor="middle"
          fontFamily={FONT}
          fontSize="11"
          fontWeight="800"
          fill="#E60012"
        >
          N
        </text>
      </>
    ),
  },
  {
    title: "Amazon",
    aliases: ["amazoncom", "amazonprime", "primevideo"],
    Mark: () => (
      <>
        <text
          x="12"
          y="15"
          textAnchor="middle"
          fontFamily={FONT}
          fontSize="19"
          fontWeight="700"
          fill={LIGHT}
        >
          a
        </text>
        <Smile y={17.5} />
      </>
    ),
  },
  {
    title: "AWS",
    aliases: ["amazonwebservices", "awsconsole", "awsroot", "awsiam"],
    Mark: () => (
      <>
        <text
          x="12"
          y="13"
          textAnchor="middle"
          fontFamily={FONT}
          fontSize="9.5"
          fontWeight="800"
          fill={LIGHT}
        >
          aws
        </text>
        <Smile y={15.5} />
      </>
    ),
  },
];
