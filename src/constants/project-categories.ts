export type ProjectCategory =
  | "web"
  | "mobile"
  | "desktop"
  | "backend"
  | "cloud-devops"
  | "data-engineering"
  | "ai-ml"
  | "ai-agents"
  | "generative-ai"
  | "dev-tools"
  | "libraries-frameworks"
  | "integration"
  | "embedded-iot"
  | "gaming-graphics"
  | "security"
  | "blockchain-web3"
  | "ar-vr-xr"
  | "multimedia"
  | "automation-scripting"
  | "database-storage"
  | "testing-qa"
  | "other";

// C01 (Jose, 2026-11-09): 22 categories. Keys never change, so stored projects
// keep theirs; three keys got new labels (ai-ml, automation-scripting,
// data-engineering) and three are new (ai-agents, generative-ai,
// libraries-frameworks).
//
// The filing rule, repeated in the descriptions so people choose the same way:
// file by how it's built, then by what it does. If AI is the core of the
// product, use an AI category whatever the platform. If AI is one feature,
// file by platform and tag it. Anything built in an automation platform (n8n,
// Zapier, Make, Power Automate) goes in Automation & Workflows even with AI
// steps, tagged `ai-agent`.
export const PROJECT_CATEGORIES = {
  web: {
    label: "Web Applications",
    description: "Browser-based applications and websites",
    keywords: "react vue angular svelte nextjs frontend spa pwa html css javascript typescript web app website portal dashboard",
  },
  mobile: {
    label: "Mobile Applications",
    description: "iOS, Android, and cross-platform mobile apps",
    keywords: "ios android react-native flutter swift kotlin java mobile app smartphone tablet cross-platform",
  },
  desktop: {
    label: "Desktop Applications",
    description: "Desktop software and system utilities",
    keywords: "electron tauri windows macos linux desktop gui native application software utility tool",
  },
  backend: {
    label: "Backend Systems",
    description: "Server-side applications, APIs and services. Database engines go in Databases & Storage; pipelines and analysis in Data & Analytics",
    keywords: "api rest graphql node express fastify nestjs django flask spring microservices server backend service",
  },
  "cloud-devops": {
    label: "Cloud & DevOps",
    description: "Cloud infrastructure and deployment systems",
    keywords: "aws azure gcp kubernetes docker terraform ansible jenkins cicd pipeline deployment infrastructure cloud devops iac container orchestration",
  },
  "data-engineering": {
    label: "Data & Analytics",
    description: "Data pipelines plus analysis: ETL, notebooks, dashboards and visualization. Database engines and storage go in Databases & Storage",
    keywords: "etl pipeline spark hadoop kafka airflow dbt databricks snowflake bigquery data warehouse analytics processing batch streaming notebook jupyter pandas dashboard visualization bi tableau looker power-bi report statistics",
  },
  "ai-ml": {
    label: "ML Models & Research",
    description: "The models themselves: training, fine-tuning, computer vision, speech, NLP and evaluations. Apps built on a model go in Generative AI Apps or AI Agents & Assistants",
    keywords: "machine learning deep learning neural network tensorflow pytorch jax scikit-learn nlp computer vision speech model training fine-tuning inference evaluation benchmark dataset research",
  },
  "ai-agents": {
    label: "AI Agents & Assistants",
    description: "Agents and assistants written as software: chatbots, coding assistants, MCP servers and agent frameworks. Use it when AI is the core of the product; if it's one feature, file by platform and tag it",
    keywords: "ai agent assistant chatbot copilot coding-assistant mcp model-context-protocol tool-calling function-calling langchain langgraph crewai autogen agent-framework multi-agent llm",
  },
  "generative-ai": {
    label: "Generative AI Apps",
    description: "Apps whose main job is producing content or answers from models: LLM apps, RAG, and image, video and audio generation. If AI is one feature, file by platform and tag it",
    keywords: "generative ai genai llm gpt claude gemini rag retrieval embeddings vector prompt text-generation image-generation stable-diffusion diffusion video-generation audio-generation text-to-speech",
  },
  "dev-tools": {
    label: "Development Tools",
    description: "Tools developers run while they work: CLIs, IDE extensions, linters, debuggers, generators. Installable packages go in Libraries & Frameworks; CI and test runners in Testing & QA",
    keywords: "cli tool ide plugin extension vscode intellij debugging profiling linter formatter code-generator devtools developer-experience",
  },
  "libraries-frameworks": {
    label: "Libraries & Frameworks",
    description: "Reusable packages, SDKs and frameworks people install, as opposed to finished apps or tools you run",
    keywords: "library framework sdk package module npm pypi crate gem nuget maven open-source component-library ui-kit api-client wrapper",
  },
  integration: {
    label: "Integration & Extensions",
    description: "System integrations and platform extensions",
    keywords: "api integration webhook middleware connector plugin extension addon module adapter bridge gateway third-party",
  },
  "embedded-iot": {
    label: "Embedded & IoT",
    description: "Embedded systems and Internet of things applications",
    keywords: "iot embedded raspberry-pi arduino esp32 sensor actuator firmware hardware microcontroller mqtt zigbee bluetooth wifi smart-home",
  },
  "gaming-graphics": {
    label: "Gaming & Graphics",
    description: "Games, game engines and rendered graphics: 3D, shaders, simulations. Audio and video tools go in Multimedia & Streaming",
    keywords: "game unity unreal godot 3d 2d graphics rendering shader opengl vulkan webgl threejs gaming engine simulation physics",
  },
  security: {
    label: "Cybersecurity",
    description: "Security tooling, auditing, pentesting, and DevSecOps projects",
    keywords: "security penetration-testing vulnerability scanner audit encryption authentication authorization owasp devsecops firewall ids ips siem threat-detection malware",
  },
  "blockchain-web3": {
    label: "Blockchain & Web3",
    description: "Decentralized applications, smart contracts, and Web3 tooling",
    keywords: "blockchain ethereum solidity web3 defi nft dapp smart-contract crypto cryptocurrency bitcoin polygon avalanche dao decentralized wallet",
  },
  "ar-vr-xr": {
    label: "AR/VR & XR",
    description: "Augmented, virtual, and extended-reality experiences",
    keywords: "augmented-reality virtual-reality vr ar xr mixed-reality oculus quest hololens spatial metaverse 3d immersive webxr",
  },
  multimedia: {
    label: "Multimedia & Streaming",
    description: "Audio and video capture, editing, players and streaming. Games and real-time 3D go in Gaming & Graphics; AI that generates media in Generative AI Apps",
    keywords: "video audio streaming ffmpeg webrtc hls rtmp transcoding media player editor codec live-stream broadcast podcast recording",
  },
  "automation-scripting": {
    label: "Automation & Workflows",
    description: "Scripts, bots and workflows, including anything built in n8n, Zapier, Make or Power Automate, even with AI steps (tag those ai-agent). Developer tools go in Development Tools; CI in Testing & QA",
    keywords: "automation script workflow rpa bot n8n zapier make power-automate ifttt selenium puppeteer cron scheduler task workflow-automation python bash shell powershell no-code low-code",
  },
  "database-storage": {
    label: "Databases & Storage",
    description: "Database engines, storage and caching, migration tools and ORMs. Apps that use a database go under their platform; pipelines and analysis in Data & Analytics",
    keywords: "database sql nosql postgresql mysql mongodb redis elasticsearch cassandra migration orm prisma sequelize typeorm storage cache",
  },
  "testing-qa": {
    label: "Testing & QA",
    description: "Test frameworks, test runners, CI test setups and coverage tools",
    keywords: "testing jest mocha cypress playwright selenium unit-test integration-test e2e test-automation qa coverage tdd bdd quality-assurance ci",
  },
  other: {
    label: "Other",
    description: "Miscellaneous projects that don't fit into other categories",
    keywords: "miscellaneous other general experimental prototype proof-of-concept educational learning tutorial",
  },
} as const;

/**
 * UI07 (Jose, 2026-11-09): the short form of a category's description, for
 * cards and tiles. It's the text up to the first sentence end or colon; the
 * tie-break wording after it ("X goes in Y") stays on /categories/<key> and
 * in the create and edit category picker.
 */
export function categorySummary(description: string): string {
  const cut = description.search(/\.\s|:\s|\.$/);
  return (cut === -1 ? description : description.slice(0, cut)).trim();
}
