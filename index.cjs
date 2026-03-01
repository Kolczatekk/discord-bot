const {
  Client,
  GatewayIntentBits,
  Events,
  EmbedBuilder, 
  SlashCommandBuilder,
  REST,
  Routes,
  PermissionFlagsBits,
  ChannelType,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ModalBuilder,  
  TextInputBuilder,
  TextInputStyle, 
  PermissionsBitField,
  ButtonBuilder,
  ButtonStyle,  
  AttachmentBuilder,
  MessageFlags,
} = require("discord.js");
const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

// Load local .env when running on a PC (Render ma własne env vars)
try {
  require("dotenv").config({ path: path.resolve(__dirname, ".env") });
} catch (err) {
  console.warn("[ENV] Nie udało się załadować .env:", err?.message || err);
}
const db = require("./database.js");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMembers,
  ]
});

/*
  In-memory stores
*/
const activeCodes = new Map();
const opinieChannels = new Map();
const ticketCounter = new Map();
const fourMonthBlockList = new Map(); // guildId -> Set(userId)
const ticketCategories = new Map();
const legitRepCooldown = new Map(); // userId -> timestamp ostatniego poprawnego +rep
const dropChannels = new Map(); // <-- mapa kanałów gdzie można używać /drop
const sprawdzZaproszeniaCooldowns = new Map(); // userId -> lastTs
const inviteTotalJoined = new Map(); // guild -> userId -> liczba wszystkich dołączeń
const inviteFakeAccounts = new Map(); // guild -> userId -> liczba kont < 4 miesiące
const inviteBonusInvites = new Map(); // guild -> userId -> dodatkowe zaproszenia (z /ustawzaproszenia)
const inviteRewardsGiven = new Map(); // NEW: guild -> userId -> ile nagród już przyznano

// Helper: funkcja zwracająca poprawną formę słowa "zaproszenie"
function getInviteWord(count) {
  if (count === 1) return "zaproszenie";
  if (count >= 2 && count <= 4) return "zaproszenia";
  return "zaproszeń";
}

// NEW: weryfikacja
const verificationRoles = new Map(); // guildId -> roleId
const pendingVerifications = new Map(); // modalId -> { answer, guildId, userId, roleId }

const ticketOwners = new Map(); // channelId -> { claimedBy, userId, ticketMessageId, locked, lastClaimMsgId }
const pendingClaimQuiz = new Map(); // modalId -> { channelId, userId, answer }
const autoPrzejmijSettings = new Map(); // guildId -> { enabled, ownerId, ownerName, enabledAt }
const pendingAutoPrzejmijQuiz = new Map(); // modalId -> { guildId, userId, ownerId, ownerName, answer }

// NEW: keep last posted instruction message per channel so we can delete & re-post
const lastOpinionInstruction = new Map(); // channelId -> messageId
const lastDropInstruction = new Map(); // channelId -> messageId  <-- NEW for drop instructions
const lastInviteInstruction = new Map(); // channelId -> messageId  <-- NEW for invite instructions

// Mapa do przechowywania wyborów użytkowników dla kalkulatora
const kalkulatorData = new Map(); // userId -> { tryb, metoda, typ }

// Contest maps (new)
const contestParticipants = new Map(); // messageId -> Set(userId)
const contests = new Map(); // messageId -> { channelId, endsAt, winnersCount, title, prize, imageUrl }
const contestLeaveBlocks = new Map(); // userId -> { messageId: { leaveCount: number, blockedUntil: number } }

// --- LEGITCHECK-REP info behavior --------------------------------------------------
// channel ID where users post freeform reps and the bot should post the informational embed
const REP_CHANNEL_ID = "1449840030947217529";

// cooldown (ms) per user between the bot posting the info embed
const INFO_EMBED_COOLDOWN_MS = 5 * 1000; // default 5s — change to desired value

// map used for throttling per-user
const infoCooldowns = new Map(); // userId -> timestamp (ms)

// banner/gif url to show at bottom of embed (change this to your gif/url)
const REP_EMBED_BANNER_URL =
  "https://cdn.discordapp.com/attachments/1449367698374004869/1450192787894046751/standard_1.gif";

// track last info message posted by the bot per channel so we can delete it before posting a new one
const repLastInfoMessage = new Map(); // channelId -> messageId

// /mody: list of proof videos shown after clicking the button
const MODS_VIDEO_FILES = [
  {
    key: "no_entities",
    label: "No_entities (1440x2560)",
    modName: "NoEntities",
    filename: "No_entities.mov",
    filenameAliases: ["No_entities.mp4"],
    localPath: path.join(__dirname, "attached_assets", "No_entities.mov"),
    envVar: "MODS_VIDEO_URL_NO_ENTITIES",
  },
  {
    key: "sprawdz_procenty",
    label: "Sprawdz_procenty",
    modName: "SprawdzProcenty",
    filename: "Sprawdz_procenty.mov",
    filenameAliases: ["Sprawdz_procenty.mp4"],
    localPath: path.join(__dirname, "attached_assets", "Sprawdz_procenty.mov"),
    envVar: "MODS_VIDEO_URL_SPRAWDZ_PROCENTY",
  },
  {
    key: "auto_dzwignia",
    label: "Auto_dźwignia",
    modName: "AutoDzwignia",
    filename: "Auto_dźwignia.mov",
    filenameAliases: [
      "Auto_dźwignia (1).mov",
      "Auto_dzwignia.mov",
      "Auto_dzwignia (1).mov",
    ],
    localPath: path.join(__dirname, "attached_assets", "Auto_dźwignia.mov"),
    envVar: "MODS_VIDEO_URL_AUTO_DZWIGNIA",
    defaultUrl:
      "https://cdn.discordapp.com/attachments/1350603811512909914/1477659247511605340/Auto_dzwignia.mov?ex=69a590ea&is=69a43f6a&hm=045a8441610b16e22135e2a267ba139021cd498791c71861627d4dc486506284",
  },
  {
    key: "auto_dripstone",
    label: "Auto_Dripstone",
    modName: "AutoDripstone",
    filename: "Auto_Dripstone.mov",
    filenameAliases: ["Auto_Dripstone.mp4"],
    localPath: path.join(__dirname, "attached_assets", "Auto_Dripstone.mov"),
    envVar: "MODS_VIDEO_URL_AUTO_DRIPSTONE",
    defaultUrl:
      "https://cdn.discordapp.com/attachments/1350603811512909914/1477659253664780402/Auto_Dripstone.mov?ex=69a590eb&is=69a43f6b&hm=51a15faf631c567393b82b6fcc017661cb20775ddd517b723100456f914b1fed",
  },
];
const modsVideoUrlCache = new Map(); // key -> url
const DISCORD_MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const MODS_VIDEO_SEND_ORDER = [
  "auto_dripstone",
  "no_entities",
  "auto_dzwignia",
  "sprawdz_procenty",
];
const modsVideoOrderRanks = new Map(
  MODS_VIDEO_SEND_ORDER.map((key, idx) => [key, idx]),
);

// legit rep counter
let legitRepCount = 15;
let lastChannelRename = 0;
const CHANNEL_RENAME_COOLDOWN = 10 * 60 * 1000; // 10 minutes (Discord limit)
let pendingRename = false;

// NEW: cooldowns & limits
const DROP_COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4 hours per user
const OPINION_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes per user

// FREE KASA cooldown (3h) and allowed channel
const FREE_KASA_COOLDOWN_MS = 3 * 60 * 60 * 1000;
const FREE_KASA_CHANNEL_ID = "1470103962245005454";

const dropCooldowns = new Map(); // userId -> timestamp (ms)
const freeKasaCooldowns = new Map(); // userId -> timestamp (ms)
const opinionCooldowns = new Map(); // userId -> timestamp (ms)

// Colors
const COLOR_BLUE = 0x00aaff;
const COLOR_YELLOW = 0xffd700;
const COLOR_GRAY = 0x808080;
const COLOR_RED = 0x8b0000;

// New maps for ticket close confirmation
const pendingTicketClose = new Map(); // channelId -> { userId, ts }

// ------------------ Invite tracking & protections ------------------
const guildInvites = new Map(); // guildId -> Map<code, uses>
const inviteCounts = new Map(); // guildId -> Map<inviterId, count>  (current cycle count)
const inviterOfMember = new Map(); // `${guildId}:${memberId}` -> inviterId
const INVITE_REWARD_THRESHOLD = 5;
const INVITE_REWARD_TEXT = "50k$"; // <-- zmienione z 40k$ na 50k$

// Nowa struktura do śledzenia nagród za konkretne progi
// guildId -> Map<userId, Set<rewardLevel>> gdzie rewardLevel to "5", "10", "15", etc.
const inviteRewardLevels = new Map();

// additional maps:
const inviteRewards = new Map(); // guildId -> Map<inviterId, rewardsGiven>
const inviterRateLimit = new Map(); // guildId -> Map<inviterId, [timestamps]> to limit invites per hour
// track members who left so we can undo "leave" counters if they rejoin
const leaveRecords = new Map(); // key = `${guildId}:${memberId}` -> inviterId

// keep invite cache up-to-date (global listeners, NOT inside GuildMemberAdd)
client.on("inviteCreate", (invite) => {
  try {
    const map = guildInvites.get(invite.guild.id) || new Map();
    map.set(invite.code, invite.uses || 0);
    guildInvites.set(invite.guild.id, map);
    scheduleSavePersistentState();
  } catch (e) {
    console.warn("inviteCreate handler error:", e);
  }
});
client.on("inviteDelete", (invite) => {
  try {
    const map = guildInvites.get(invite.guild.id);
    if (map) {
      map.delete(invite.code);
      guildInvites.set(invite.guild.id, map);
      scheduleSavePersistentState();
    }
  } catch (e) {
    console.warn("inviteDelete handler error:", e);
  }
});
// Invite rate-limit settings (zapobiega nadużyciom liczenia zaproszeń)
const INVITER_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 godzina
const INVITER_RATE_LIMIT_MAX = 10; // maksymalnie 10 zaproszeń w oknie (zmień wedle potrzeby)
// track how many people left per inviter (for /sprawdz-zaproszenia)
const inviteLeaves = new Map(); // guildId -> Map<inviterId, leftCount>
// -----------------------------------------------------

// Konfiguracja Supabase
const supabaseUrl = process.env.SUPABASE_URL || 'https://your-project.supabase.co';
const supabaseKey = process.env.SUPABASE_ANON_KEY || 'your-anon-key';
const supabase = createClient(supabaseUrl, supabaseKey);

// Prefer Persistent Disk on Render, fallback to local file (tylko jako backup)
const STORE_FILE = process.env.STORE_FILE
  ? path.resolve(process.env.STORE_FILE)
  : (fs.existsSync("/opt/render/project") ? "/opt/render/project/data/legit_store.json" : path.join(__dirname, "legit_store.json"));

// Force Render persistent disk path
if (fs.existsSync("/opt/render/project")) {
  process.env.STORE_FILE = "/opt/render/project/data/legit_store.json";
}

try {
  const dir = path.dirname(STORE_FILE);
  if (dir && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
} catch (e) {
  console.warn("Nie udało się przygotować katalogu dla STORE_FILE:", e);
}

try {
  const exists = fs.existsSync(STORE_FILE);
  const size = exists ? fs.statSync(STORE_FILE).size : 0;
  console.log(`[state] STORE_FILE=${STORE_FILE} exists=${exists} size=${size}`);
} catch (e) {
  console.warn("[state] Nie udało się odczytać informacji o STORE_FILE:", e);
}

// -------- Persistent storage helpers (invites, tickets, legit-rep) --------
function nestedObjectToMapOfMaps(source) {
  const top = new Map();
  if (!source || typeof source !== "object") return top;
  for (const [outerKey, innerObj] of Object.entries(source)) {
    const innerMap = new Map();
    if (innerObj && typeof innerObj === "object") {
      for (const [innerKey, value] of Object.entries(innerObj)) {
        innerMap.set(innerKey, value);
      }
    }
    top.set(outerKey, innerMap);
  }
  return top;
}

function mapOfMapsToPlainObject(topMap) {
  const obj = {};
  for (const [outerKey, innerMap] of topMap.entries()) {
    obj[outerKey] = {};
    if (innerMap && typeof innerMap.forEach === "function") {
      innerMap.forEach((value, innerKey) => {
        obj[outerKey][innerKey] = value;
      });
    }
  }
  return obj;
}

let saveStateTimeout = null;
function buildPersistentStateData() {
  // Convert contests to plain object
  const contestsObj = {};
  for (const [msgId, meta] of contests.entries()) {
    // ensure meta is serializable (avoid functions)
    contestsObj[msgId] = {
      ...(meta || {}),
      endsAt: meta && meta.endsAt ? meta.endsAt : null,
    };
  }

  // Convert contest participants to plain object
  const participantsObj = {};
  for (const [msgId, setOrMap] of contestParticipants.entries()) {
    // contestParticipants may store Set or Map — normalize to array of [userId, nick] pairs
    if (setOrMap instanceof Set) {
      // Convert Set to array of [userId, ""] pairs (backward compatibility)
      participantsObj[msgId] = Array.from(setOrMap).map(userId => [userId, ""]);
    } else if (
      typeof setOrMap === "object" &&
      typeof setOrMap.forEach === "function"
    ) {
      // Convert Map(userId -> nick) to array of [userId, nick] pairs
      participantsObj[msgId] = Array.from(setOrMap.entries());
    } else {
      participantsObj[msgId] = [];
    }
  }

  // Convert contest leave blocks to plain object
  const leaveBlocksObj = {};
  if (typeof contestLeaveBlocks !== "undefined" && contestLeaveBlocks instanceof Map) {
    for (const [userId, contestBlocks] of contestLeaveBlocks.entries()) {
      if (contestBlocks && typeof contestBlocks === "object") {
        leaveBlocksObj[userId] = {};
        for (const [msgId, blockData] of Object.entries(contestBlocks)) {
          leaveBlocksObj[userId][msgId] = {
            leaveCount: blockData.leaveCount || 0,
            blockedUntil: blockData.blockedUntil || 0
          };
        }
      }
    }
  }

  // optional: serialize fourMonthBlockList if you've added it
  const fourMonthObj = {};
  if (
    typeof fourMonthBlockList !== "undefined" &&
    fourMonthBlockList instanceof Map
  ) {
    for (const [gId, setOfUsers] of fourMonthBlockList.entries()) {
      fourMonthObj[gId] = Array.from(setOfUsers || []);
    }
  }

  // Convert guildInvites to plain object
  const guildInvitesObj = {};
  if (typeof guildInvites !== "undefined" && guildInvites instanceof Map) {
    for (const [guildId, inviteMap] of guildInvites.entries()) {
      if (inviteMap && typeof inviteMap.forEach === "function") {
        guildInvitesObj[guildId] = {};
        inviteMap.forEach((uses, code) => {
          guildInvitesObj[guildId][code] = uses;
        });
      }
    }
  }

  // Convert inviterOfMember to plain object
  const inviterOfMemberObj = {};
  if (typeof inviterOfMember !== "undefined" && inviterOfMember instanceof Map) {
    for (const [key, inviterId] of inviterOfMember.entries()) {
      inviterOfMemberObj[key] = inviterId;
    }
  }

  // Convert inviterRateLimit to plain object
  const inviterRateLimitObj = {};
  if (typeof inviterRateLimit !== "undefined" && inviterRateLimit instanceof Map) {
    for (const [guildId, rateMap] of inviterRateLimit.entries()) {
      if (rateMap && typeof rateMap.forEach === "function") {
        inviterRateLimitObj[guildId] = {};
        rateMap.forEach((timestamps, inviterId) => {
          inviterRateLimitObj[guildId][inviterId] = timestamps;
        });
      }
    }
  }

  // Convert leaveRecords to plain object
  const leaveRecordsObj = {};
  if (typeof leaveRecords !== "undefined" && leaveRecords instanceof Map) {
    for (const [key, inviterId] of leaveRecords.entries()) {
      leaveRecordsObj[key] = inviterId;
    }
  }

  // Convert verificationRoles to plain object
  const verificationRolesObj = {};
  if (typeof verificationRoles !== "undefined" && verificationRoles instanceof Map) {
    for (const [guildId, roleId] of verificationRoles.entries()) {
      verificationRolesObj[guildId] = roleId;
    }
  }

  // Convert pendingVerifications to plain object
  const pendingVerificationsObj = {};
  if (typeof pendingVerifications !== "undefined" && pendingVerifications instanceof Map) {
    for (const [modalId, data] of pendingVerifications.entries()) {
      pendingVerificationsObj[modalId] = data;
    }
  }

  // Convert ticketCategories to plain object
  const ticketCategoriesObj = {};
  if (typeof ticketCategories !== "undefined" && ticketCategories instanceof Map) {
    for (const [guildId, categories] of ticketCategories.entries()) {
      ticketCategoriesObj[guildId] = categories;
    }
  }

  // Convert dropChannels to plain object
  const dropChannelsObj = {};
  if (typeof dropChannels !== "undefined" && dropChannels instanceof Map) {
    for (const [guildId, channelId] of dropChannels.entries()) {
      dropChannelsObj[guildId] = channelId;
    }
  }

  // Convert sprawdzZaproszeniaCooldowns to plain object
  const sprawdzZaproszeniaCooldownsObj = {};
  if (typeof sprawdzZaproszeniaCooldowns !== "undefined" && sprawdzZaproszeniaCooldowns instanceof Map) {
    for (const [userId, timestamp] of sprawdzZaproszeniaCooldowns.entries()) {
      sprawdzZaproszeniaCooldownsObj[userId] = timestamp;
    }
  }

  // Convert lastOpinionInstruction to plain object
  const lastOpinionInstructionObj = {};
  if (typeof lastOpinionInstruction !== "undefined" && lastOpinionInstruction instanceof Map) {
    for (const [channelId, messageId] of lastOpinionInstruction.entries()) {
      lastOpinionInstructionObj[channelId] = messageId;
    }
  }

  // Convert lastDropInstruction to plain object
  const lastDropInstructionObj = {};
  if (typeof lastDropInstruction !== "undefined" && lastDropInstruction instanceof Map) {
    for (const [channelId, messageId] of lastDropInstruction.entries()) {
      lastDropInstructionObj[channelId] = messageId;
    }
  }

  // Convert kalkulatorData to plain object
  const kalkulatorDataObj = {};
  if (typeof kalkulatorData !== "undefined" && kalkulatorData instanceof Map) {
    for (const [userId, data] of kalkulatorData.entries()) {
      kalkulatorDataObj[userId] = data;
    }
  }

  // Convert infoCooldowns to plain object
  const infoCooldownsObj = {};
  if (typeof infoCooldowns !== "undefined" && infoCooldowns instanceof Map) {
    for (const [userId, timestamp] of infoCooldowns.entries()) {
      infoCooldownsObj[userId] = timestamp;
    }
  }

  // Convert repLastInfoMessage to plain object
  const repLastInfoMessageObj = {};
  if (typeof repLastInfoMessage !== "undefined" && repLastInfoMessage instanceof Map) {
    for (const [channelId, messageId] of repLastInfoMessage.entries()) {
      repLastInfoMessageObj[channelId] = messageId;
    }
  }

  // Convert dropCooldowns to plain object
  const dropCooldownsObj = {};
  if (typeof dropCooldowns !== "undefined" && dropCooldowns instanceof Map) {
    for (const [userId, timestamp] of dropCooldowns.entries()) {
      dropCooldownsObj[userId] = timestamp;
    }
  }

  // Convert opinionCooldowns to plain object
  const opinionCooldownsObj = {};
  if (typeof opinionCooldowns !== "undefined" && opinionCooldowns instanceof Map) {
    for (const [userId, timestamp] of opinionCooldowns.entries()) {
      opinionCooldownsObj[userId] = timestamp;
    }
  }

  // Convert pendingTicketClose to plain object
  const pendingTicketCloseObj = {};
  if (typeof pendingTicketClose !== "undefined" && pendingTicketClose instanceof Map) {
    for (const [channelId, data] of pendingTicketClose.entries()) {
      pendingTicketCloseObj[channelId] = data;
    }
  }

  // Convert inviteRewardLevels to plain object
  const inviteRewardLevelsObj = {};
  if (typeof inviteRewardLevels !== "undefined" && inviteRewardLevels instanceof Map) {
    for (const [guildId, userMap] of inviteRewardLevels.entries()) {
      inviteRewardLevelsObj[guildId] = {};
      if (userMap && typeof userMap.forEach === "function") {
        userMap.forEach((levelSet, userId) => {
          inviteRewardLevelsObj[guildId][userId] = Array.from(levelSet || []);
        });
      }
    }
  }

  // Convert opinieChannels to plain object
  const opinieChannelsObj = {};
  if (typeof opinieChannels !== "undefined" && opinieChannels instanceof Map) {
    for (const [guildId, channelId] of opinieChannels.entries()) {
      opinieChannelsObj[guildId] = channelId;
    }
  }

  const data = {
    legitRepCount,
    legitRepCooldown: Object.fromEntries(legitRepCooldown),
    ticketCounter: Object.fromEntries(ticketCounter),
    ticketOwners: Object.fromEntries(ticketOwners),
    inviteCounts: mapOfMapsToPlainObject(inviteCounts),
    inviteRewards: mapOfMapsToPlainObject(inviteRewards),
    inviteLeaves: mapOfMapsToPlainObject(inviteLeaves),
    inviteRewardsGiven: mapOfMapsToPlainObject(inviteRewardsGiven),
    inviteRewardLevels: inviteRewardLevelsObj,
    inviteTotalJoined: mapOfMapsToPlainObject(inviteTotalJoined),
    inviteFakeAccounts: mapOfMapsToPlainObject(inviteFakeAccounts),
    inviteBonusInvites: mapOfMapsToPlainObject(inviteBonusInvites),
    lastInviteInstruction: Object.fromEntries(lastInviteInstruction),
    contests: contestsObj,
    contestParticipants: participantsObj,
    contestLeaveBlocks: leaveBlocksObj,
    fourMonthBlockList: fourMonthObj,
    weeklySales: Object.fromEntries(weeklySales),
    activeCodes: Object.fromEntries(activeCodes),
    guildInvites: guildInvitesObj,
    inviterOfMember: inviterOfMemberObj,
    inviterRateLimit: inviterRateLimitObj,
    leaveRecords: leaveRecordsObj,
    verificationRoles: verificationRolesObj,
    pendingVerifications: pendingVerificationsObj,
    ticketCategories: ticketCategoriesObj,
    dropChannels: dropChannelsObj,
    sprawdzZaproszeniaCooldowns: sprawdzZaproszeniaCooldownsObj,
    lastOpinionInstruction: lastOpinionInstructionObj,
    lastDropInstruction: lastDropInstructionObj,
    kalkulatorData: kalkulatorDataObj,
    infoCooldowns: infoCooldownsObj,
    repLastInfoMessage: repLastInfoMessageObj,
    dropCooldowns: dropCooldownsObj,
    opinionCooldowns: opinionCooldownsObj,
    pendingTicketClose: pendingTicketCloseObj,
    opinieChannels: opinieChannelsObj,
    autoPrzejmijSettings: Object.fromEntries(autoPrzejmijSettings),
  };

  return data;
}

// Funkcje do obsługi Supabase
async function saveStateToSupabase(data) {
  try {
    const { error } = await supabase
      .from('bot_state')
      .upsert({ 
        id: 1, 
        data: data,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'id'
      });
    
    if (error) {
      console.error('[supabase] Błąd zapisu:', error);
      return false;
    }
    
    console.log('[supabase] Stan zapisany pomyślnie');
    return true;
  } catch (error) {
    console.error('[supabase] Błąd podczas zapisu:', error);
    return false;
  }
}

// ----------------- /free-kasa command -----------------
async function handleFreeKasaCommand(interaction) {
  const user = interaction.user;
  const guildId = interaction.guildId;

  if (!guildId) {
    await interaction.reply({
      content: "> `❌` × **Ta komenda** działa tylko na **serwerze**!",
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // tylko właściciel serwera
  if (interaction.user.id !== interaction.guild.ownerId) {
    await interaction.reply({
      content: "> `❗` × Brak wymaganych uprawnień.",
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // wymagany kanał
  if (interaction.channelId !== FREE_KASA_CHANNEL_ID) {
    await interaction.reply({
      content: `> \`❌\` × Użyj tej **komendy** na kanale <#${FREE_KASA_CHANNEL_ID}>`,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const last = freeKasaCooldowns.get(user.id) || 0;
  const now = Date.now();
  if (now - last < FREE_KASA_COOLDOWN_MS) {
    const remaining = FREE_KASA_COOLDOWN_MS - (now - last);
    await interaction.reply({
      content: `> \`❌\` × Możesz użyć komendy /free-kasa ponownie za \`${humanizeMs(remaining)}\``,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  freeKasaCooldowns.set(user.id, now);

  // Szanse: brak wygranej (50%), 5k (30%), 10k (15%), 30k (5%)
  const roll = Math.random() * 100;
  let reward = 0;
  if (roll < 5) reward = 30000;
  else if (roll < 20) reward = 10000;
  else if (roll < 50) reward = 5000;
  else reward = 0;

  if (reward <= 0) {
    const embed = new EmbedBuilder()
      .setColor(COLOR_GRAY)
      .setDescription(
        "```\n" +
        "💵 New Shop × DARMOWA KASA\n" +
        "```\n" +
        `\`👤\` × **Użytkownik:** ${user}\n` +
        "\`😢\` × **Niestety, tym razem nie udało się! Spróbuj ponownie później...**",
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
    return;
  }

  const rewardText = `${reward >= 1000 ? reward / 1000 + "k" : reward}`;
  const embed = new EmbedBuilder()
    .setColor(COLOR_YELLOW)
    .setDescription(
      "```\n" +
      "💵 New Shop × DARMOWA KASA\n" +
      "```\n" +
      `\`👤\` × **Użytkownik:** ${user}\n` +
      `\`🎉\` × **Gratulacje! Wygrałeś ${rewardText} na anarchia LF**\n`,
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
}

// Handler dla komendy /wezwij
async function handleWezwijCommand(interaction) {
  const channel = interaction.channel;

  if (!channel || channel.type !== ChannelType.GuildText || !isTicketChannel(channel)) {
    await interaction.reply({
      content: "> `❌` × Użyj tej komendy na kanale ticketu.",
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // Sprawdź uprawnienia: tylko sprzedawca
  const SELLER_ROLE_ID = "1350786945944391733";
  if (!interaction.member?.roles?.cache?.has(SELLER_ROLE_ID)) {
    await interaction.reply({
      content: "> `❌` × Brak uprawnień do użycia tej komendy.",
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const ticketData = ticketOwners.get(channel.id);
  const ownerId = ticketData?.userId;

  if (!ownerId) {
    await interaction.reply({
      content: "> `❌` × Nie mogę znaleźć właściciela tego ticketu.",
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const channelLink = `https://discord.com/channels/${interaction.guildId}/${channel.id}`;
  // użyj formatu animowanego (a:...) jeśli emoji jest GIFem
  const arrowEmoji = '<a:arrowwhite:1469100658606211233>';

  try {
    const user = await client.users.fetch(ownerId);

    const embed = new EmbedBuilder()
      .setColor(COLOR_BLUE)
      .setDescription(
        "```\n" +
          "🚨 New Shop × JESTES WZYWANY\n" +
        "```\n" +
        `${arrowEmoji} **jesteś wzywany** na **swojego ticketa**!\n` +
        `${arrowEmoji} **Masz** **__4 godziny__** na odpowiedź lub ticket **zostanie zamknięty!**\n\n` +
        `**KANAŁ:** ${channelLink}`
      );

    await user.send({ embeds: [embed] });

    await interaction.reply({
      content: `> ` + "`✅`" + ` × Wysłano wezwanie do właściciela ticketu.`,
      flags: [MessageFlags.Ephemeral],
    });
  } catch (err) {
    console.error("[wezwij] Błąd DM:", err);
    await interaction.reply({
      content: "> `❌` × Nie udało się wysłać wiadomości do właściciela (ma wyłączone DM lub nie znaleziono użytkownika).",
      flags: [MessageFlags.Ephemeral],
    });
  }
}

async function loadStateFromSupabase() {
  try {
    const { data, error } = await supabase
      .from('bot_state')
      .select('data')
      .eq('id', 1)
      .single();
    
    if (error) {
      if (error.code === 'PGRST116') {
        console.log('[supabase] Nie znaleziono stanu, tworzę nowy');
        return null;
      }
      console.error('[supabase] Błąd odczytu:', error);
      return null;
    }
    
    console.log('[supabase] Stan wczytany pomyślnie');
    return data.data;
  } catch (error) {
    console.error('[supabase] Błąd podczas odczytu:', error);
    return null;
  }
}

function flushPersistentStateSync() {
  try {
    const data = buildPersistentStateData();
    
    // Tylko zapis do Supabase
    saveStateToSupabase(data);
    
    console.log(`[state] flush ok -> supabase only`);
  } catch (e) {
    console.error("[state] flush failed:", e);
  }
}

function scheduleSavePersistentState(immediate = false) {
  // debounce writes to avoid spamming disk
  if (saveStateTimeout) return;
  
  if (immediate) {
    // Natychmiastowy zapis dla krytycznych danych
    saveStateTimeout = setTimeout(() => {
      saveStateTimeout = null;
      try {
        const data = buildPersistentStateData();
        // Tylko zapis do Supabase
        saveStateToSupabase(data);
        console.log(`[state] immediate save ok -> supabase only`);
      } catch (err) {
        console.error("Nie udało się zapisać stanu bota (immediate):", err);
      }
    }, 100); // Bardzo krótkie opóźnienie
  } else {
    // Standardowy debounced save
    saveStateTimeout = setTimeout(() => {
      saveStateTimeout = null;
      try {
        const data = buildPersistentStateData();
        // Tylko zapis do Supabase
        saveStateToSupabase(data);
        console.log(`[state] save ok -> supabase only`);
      } catch (err) {
        console.error("Błąd serializacji stanu bota:", err);
      }
    }, 2000);
  }
}

async function loadPersistentState() {
  try {
    console.log("[state] Rozpoczynam wczytywanie stanu...");
    
    // Tylko wczytywanie z Supabase
    const supabaseData = await loadStateFromSupabase();
    
    if (supabaseData) {
      console.log("[state] Używam danych z Supabase");
      const botStateData = supabaseData;

      if (typeof botStateData.legitRepCount === "number") {
        legitRepCount = botStateData.legitRepCount;
      }

    if (botStateData.legitRepCooldown && typeof botStateData.legitRepCooldown === "object") {
      for (const [userId, ts] of Object.entries(botStateData.legitRepCooldown)) {
        if (typeof ts === "number") {
          legitRepCooldown.set(userId, ts);
        }
      }
    }

    if (botStateData.ticketCounter && typeof botStateData.ticketCounter === "object") {
      for (const [guildId, value] of Object.entries(botStateData.ticketCounter)) {
        if (typeof value === "number") {
          ticketCounter.set(guildId, value);
        }
      }
    }

    if (botStateData.ticketOwners && typeof botStateData.ticketOwners === "object") {
      for (const [channelId, ticketData] of Object.entries(botStateData.ticketOwners)) {
        if (ticketData && typeof ticketData === "object") {
          ticketOwners.set(channelId, ticketData);
        }
      }
    }
    if (
      botStateData.fourMonthBlockList &&
      typeof botStateData.fourMonthBlockList === "object"
    ) {
      for (const [gId, arr] of Object.entries(botStateData.fourMonthBlockList)) {
        if (Array.isArray(arr)) {
          fourMonthBlockList.set(gId, new Set(arr));
        }
      }
    }

    if (botStateData.inviteCounts) {
      const loaded = nestedObjectToMapOfMaps(botStateData.inviteCounts);
      loaded.forEach((inner, guildId) => {
        inviteCounts.set(guildId, inner);
        console.log(`[state] Wczytano inviteCounts dla guild ${guildId}: ${inner.size} wpisów`);
      });
    }

    if (botStateData.inviteRewards) {
      const loaded = nestedObjectToMapOfMaps(botStateData.inviteRewards);
      loaded.forEach((inner, guildId) => {
        inviteRewards.set(guildId, inner);
      });
    }

    if (botStateData.inviteLeaves) {
      const loaded = nestedObjectToMapOfMaps(botStateData.inviteLeaves);
      loaded.forEach((inner, guildId) => {
        inviteLeaves.set(guildId, inner);
      });
    }

    if (botStateData.inviteRewardsGiven) {
      // NEW
      const loaded = nestedObjectToMapOfMaps(botStateData.inviteRewardsGiven);
      loaded.forEach((inner, guildId) => {
        inviteRewardsGiven.set(guildId, inner);
        console.log(`[state] Wczytano inviteRewardsGiven dla guild ${guildId}: ${inner.size} wpisów`);
      });
    }

    if (botStateData.inviteRewardLevels) {
      // Load inviteRewardLevels
      for (const [guildId, userObj] of Object.entries(botStateData.inviteRewardLevels)) {
        const userMap = new Map();
        for (const [userId, levelsArray] of Object.entries(userObj)) {
          if (Array.isArray(levelsArray)) {
            userMap.set(userId, new Set(levelsArray));
          }
        }
        inviteRewardLevels.set(guildId, userMap);
      }
      console.log("[state] Wczytano inviteRewardLevels");
    }

    if (
      botStateData.lastInviteInstruction &&
      typeof botStateData.lastInviteInstruction === "object"
    ) {
      for (const [channelId, messageId] of Object.entries(
        botStateData.lastInviteInstruction,
      )) {
        if (typeof messageId === "string") {
          lastInviteInstruction.set(channelId, messageId);
        }
      }
    }

    // Load contests
    if (botStateData.contests && typeof botStateData.contests === "object") {
      for (const [msgId, meta] of Object.entries(botStateData.contests)) {
        if (meta && typeof meta.endsAt === "number") {
          contests.set(msgId, meta);
          // Schedule contest end if it hasn't ended yet
          const now = Date.now();
          if (meta.endsAt > now) {
            const delay = meta.endsAt - now;
            setTimeout(() => {
              endContestByMessageId(msgId).catch((e) => console.error(e));
            }, delay);
            console.log(
              `[contests] Przywrócono konkurs ${msgId}, zakończy się za ${Math.round(delay / 1000)}s`,
            );
          } else {
            // Contest should have ended, end it now
            setImmediate(() => {
              endContestByMessageId(msgId).catch((e) => console.error(e));
            });
          }
        }
      }
    }

    // Load contest participants
    if (
      botStateData.contestParticipants &&
      typeof botStateData.contestParticipants === "object"
    ) {
      for (const [msgId, participantData] of Object.entries(botStateData.contestParticipants)) {
        if (Array.isArray(participantData)) {
          // Check if participantData is array of [userId, nick] pairs or just userIds (backward compatibility)
          if (participantData.length > 0 && Array.isArray(participantData[0])) {
            // New format: array of [userId, nick] pairs
            contestParticipants.set(msgId, new Map(participantData));
          } else {
            // Old format: array of userIds - convert to Map with empty nicks
            const participantsMap = new Map();
            participantData.forEach(userId => {
              participantsMap.set(userId, "");
            });
            contestParticipants.set(msgId, participantsMap);
          }
        }
      }
      console.log("[state] Wczytano contestParticipants");
    }

    // Load contest leave blocks
    if (
      botStateData.contestLeaveBlocks &&
      typeof botStateData.contestLeaveBlocks === "object"
    ) {
      for (const [userId, contestBlocks] of Object.entries(botStateData.contestLeaveBlocks)) {
        if (contestBlocks && typeof contestBlocks === "object") {
          const userBlocks = {};
          for (const [msgId, blockData] of Object.entries(contestBlocks)) {
            userBlocks[msgId] = {
              leaveCount: blockData.leaveCount || 0,
              blockedUntil: blockData.blockedUntil || 0
            };
          }
          contestLeaveBlocks.set(userId, userBlocks);
        }
      }
      console.log("[state] Wczytano contestLeaveBlocks");
    }

    // Load weekly sales from Supabase
    try {
      const sales = await db.getWeeklySales();
      sales.forEach(({ user_id, amount, paid, paid_at }) => {
        weeklySales.set(user_id, { 
          amount, 
          lastUpdate: Date.now(),
          paid: paid || false, // z Supabase
          paidAt: paid_at || null
        });
      });
      console.log(`[Supabase] Wczytano weeklySales: ${sales.length} użytkowników`);
    } catch (error) {
      console.error("[Supabase] Błąd wczytywania weeklySales:", error);
    }

    // Load active codes
    try {
      const codes = await db.getActiveCodes();
      codes.forEach(({ code, ...codeData }) => {
        // Konwertuj nazwy pól na format używany w bocie
        const botCodeData = {
          oderId: codeData.user_id,
          discount: codeData.discount,
          expiresAt: new Date(codeData.expires_at).getTime(),
          used: codeData.used,
          reward: codeData.reward,
          rewardAmount: codeData.reward_amount,
          rewardText: codeData.reward_text,
          type: codeData.type
        };
        activeCodes.set(code, botCodeData);
      });
      console.log(`[Supabase] Wczytano activeCodes: ${codes.length} kodów`);
    } catch (error) {
      console.error("[Supabase] Błąd wczytywania activeCodes:", error);
    }

    // Load ticket owners from Supabase
    try {
      const ticketOwnersData = await db.getTicketOwners();
      for (const [channelId, ticketData] of Object.entries(ticketOwnersData)) {
        ticketOwners.set(channelId, ticketData);
      }
      console.log(`[Supabase] Wczytano ticketOwners: ${Object.keys(ticketOwnersData).length} wpisów`);
    } catch (error) {
      console.error("[Supabase] Błąd wczytywania ticketOwners:", error);
    }

    // Load invite total joined
    if (botStateData.inviteTotalJoined) {
      const loaded = nestedObjectToMapOfMaps(botStateData.inviteTotalJoined);
      loaded.forEach((inner, guildId) => {
        inviteTotalJoined.set(guildId, inner);
      });
    }

    // Load invite fake accounts
    if (botStateData.inviteFakeAccounts) {
      const loaded = nestedObjectToMapOfMaps(botStateData.inviteFakeAccounts);
      loaded.forEach((inner, guildId) => {
        inviteFakeAccounts.set(guildId, inner);
      });
    }

    // Load invite bonus invites
    if (botStateData.inviteBonusInvites) {
      const loaded = nestedObjectToMapOfMaps(botStateData.inviteBonusInvites);
      loaded.forEach((inner, guildId) => {
        inviteBonusInvites.set(guildId, inner);
      });
    }

    // Load guildInvites
    if (botStateData.guildInvites && typeof botStateData.guildInvites === "object") {
      for (const [guildId, inviteMap] of Object.entries(botStateData.guildInvites)) {
        if (inviteMap && typeof inviteMap === "object") {
          const map = new Map();
          for (const [code, uses] of Object.entries(inviteMap)) {
            map.set(code, uses);
          }
          guildInvites.set(guildId, map);
        }
      }
    }

    // Load inviterOfMember
    if (botStateData.inviterOfMember && typeof botStateData.inviterOfMember === "object") {
      for (const [key, memberData] of Object.entries(botStateData.inviterOfMember)) {
        if (memberData && typeof memberData === "object") {
          inviterOfMember.set(key, memberData);
        }
      }
    }

    // Load inviterRateLimit
    if (botStateData.inviterRateLimit && typeof botStateData.inviterRateLimit === "object") {
      for (const [guildId, rateMap] of Object.entries(botStateData.inviterRateLimit)) {
        if (rateMap && typeof rateMap === "object") {
          const map = new Map();
          for (const [inviterId, timestamps] of Object.entries(rateMap)) {
            map.set(inviterId, timestamps);
          }
          inviterRateLimit.set(guildId, map);
        }
      }
    }

    // Load leaveRecords
    if (botStateData.leaveRecords && typeof botStateData.leaveRecords === "object") {
      for (const [key, inviterId] of Object.entries(botStateData.leaveRecords)) {
        leaveRecords.set(key, inviterId);
      }
    }

    // Load verificationRoles
    if (botStateData.verificationRoles && typeof botStateData.verificationRoles === "object") {
      for (const [guildId, roleId] of Object.entries(botStateData.verificationRoles)) {
        verificationRoles.set(guildId, roleId);
      }
    }

    // Load pendingVerifications
    if (botStateData.pendingVerifications && typeof botStateData.pendingVerifications === "object") {
      for (const [modalId, verificationData] of Object.entries(botStateData.pendingVerifications)) {
        pendingVerifications.set(modalId, verificationData);
      }
    }

    // Load ticketCategories
    if (botStateData.ticketCategories && typeof botStateData.ticketCategories === "object") {
      for (const [guildId, categories] of Object.entries(botStateData.ticketCategories)) {
        ticketCategories.set(guildId, categories);
      }
    }

    // Load dropChannels
    if (botStateData.dropChannels && typeof botStateData.dropChannels === "object") {
      for (const [guildId, channelId] of Object.entries(botStateData.dropChannels)) {
        dropChannels.set(guildId, channelId);
      }
    }

    // Load sprawdzZaproszeniaCooldowns
    if (botStateData.sprawdzZaproszeniaCooldowns && typeof botStateData.sprawdzZaproszeniaCooldowns === "object") {
      for (const [userId, timestamp] of Object.entries(botStateData.sprawdzZaproszeniaCooldowns)) {
        sprawdzZaproszeniaCooldowns.set(userId, timestamp);
      }
    }

    // Load lastOpinionInstruction
    if (botStateData.lastOpinionInstruction && typeof botStateData.lastOpinionInstruction === "object") {
      for (const [channelId, messageId] of Object.entries(botStateData.lastOpinionInstruction)) {
        lastOpinionInstruction.set(channelId, messageId);
      }
    }

    // Load lastDropInstruction
    if (botStateData.lastDropInstruction && typeof botStateData.lastDropInstruction === "object") {
      for (const [channelId, messageId] of Object.entries(botStateData.lastDropInstruction)) {
        lastDropInstruction.set(channelId, messageId);
      }
    }

    // Load kalkulatorData
    if (botStateData.kalkulatorData && typeof botStateData.kalkulatorData === "object") {
      for (const [userId, calcData] of Object.entries(botStateData.kalkulatorData)) {
        kalkulatorData.set(userId, calcData);
      }
    }

    // Load infoCooldowns
    if (botStateData.infoCooldowns && typeof botStateData.infoCooldowns === "object") {
      for (const [userId, timestamp] of Object.entries(botStateData.infoCooldowns)) {
        infoCooldowns.set(userId, timestamp);
      }
    }

    // Load repLastInfoMessage
    if (botStateData.repLastInfoMessage && typeof botStateData.repLastInfoMessage === "object") {
      for (const [channelId, messageId] of Object.entries(botStateData.repLastInfoMessage)) {
        repLastInfoMessage.set(channelId, messageId);
      }
    }

    // Load dropCooldowns
    if (botStateData.dropCooldowns && typeof botStateData.dropCooldowns === "object") {
      for (const [userId, timestamp] of Object.entries(botStateData.dropCooldowns)) {
        dropCooldowns.set(userId, timestamp);
      }
    }

    // Load opinionCooldowns
    if (botStateData.opinionCooldowns && typeof botStateData.opinionCooldowns === "object") {
      for (const [userId, timestamp] of Object.entries(botStateData.opinionCooldowns)) {
        opinionCooldowns.set(userId, timestamp);
      }
    }

    // Load pendingTicketClose
    if (botStateData.pendingTicketClose && typeof botStateData.pendingTicketClose === "object") {
      for (const [channelId, ticketData] of Object.entries(botStateData.pendingTicketClose)) {
        pendingTicketClose.set(channelId, ticketData);
      }
    }

    // Load opinieChannels
    if (botStateData.opinieChannels && typeof botStateData.opinieChannels === "object") {
      for (const [guildId, channelId] of Object.entries(botStateData.opinieChannels)) {
        opinieChannels.set(guildId, channelId);
      }
    }

    // Load autoPrzejmijSettings
    if (botStateData.autoPrzejmijSettings && typeof botStateData.autoPrzejmijSettings === "object") {
      for (const [guildId, cfg] of Object.entries(botStateData.autoPrzejmijSettings)) {
        if (cfg && typeof cfg === "object" && cfg.enabled) {
          autoPrzejmijSettings.set(guildId, cfg);
        }
      }
    }

    try {
      let fakeGuilds = 0;
      let fakeEntries = 0;
      for (const [gId, inner] of inviteFakeAccounts.entries()) {
        fakeGuilds++;
        if (inner && typeof inner.size === "number") fakeEntries += inner.size;
      }
      console.log(
        `[state] load ok <- supabase inviteFakeAccounts guilds=${fakeGuilds} entries=${fakeEntries}`,
      );
    } catch (e) {
      // ignore
    }
    console.log("Załadowano zapisany stan bota z Supabase.");
    console.log("[state] Zakończono wczytywanie stanu");
    } else {
      console.log("[state] Nie znaleziono danych w Supabase, zaczynam z pustym stanem");
    }
  } catch (err) {
    console.error("Nie udało się odczytać stanu bota z Supabase:", err);
  }
}

function generateCode() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  for (let i = 0; i < 10; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function getNextTicketNumber(guildId) {
  const current = ticketCounter.get(guildId) || 0;
  const next = current + 1;
  ticketCounter.set(guildId, next);
  scheduleSavePersistentState();
  return next;
}

// Load persisted state once on startup (IMMEDIATELY after maps are defined)
console.log("[state] Wywołuję loadPersistentState()...");
loadPersistentState().then(() => {
  console.log("[state] loadPersistentState() zakończone");
}).catch(err => {
  console.error("[state] Błąd loadPersistentState():", err);
});

// Flush debounced state on shutdown so counters don't reset on restart
process.once("SIGINT", () => {
  try {
    if (saveStateTimeout) {
      clearTimeout(saveStateTimeout);
      saveStateTimeout = null;
    }
    flushPersistentStateSync();
  } finally {
    process.exit(0);
  }
});
process.once("SIGTERM", () => {
  try {
    if (saveStateTimeout) {
      clearTimeout(saveStateTimeout);
      saveStateTimeout = null;
    }
    flushPersistentStateSync();
  } finally {
    process.exit(0);
  }
});

// Defaults provided by user (kept mainly for categories / names)
const DEFAULT_GUILD_ID = "1350446732365926491";
const REWARDS_CATEGORY_ID = "1449455567641907351";
const DEFAULT_NAMES = {
  dropChannelName: "🎁-×┃dropy",
  verificationRoleName: "@> | 💲 klient",
  categories: {
    "zakup-0-20": "zakup 0-20",
    "zakup-20-50": "zakup 20-50",
    "zakup-50-100": "zakup 50-100",
    "zakup-100-200": "zakup 100-200+",
    sprzedaz: "sprzedaz",
    "odbior-nagrody": "nagroda za zaproszenia",
    "konkurs-nagrody": "nagroda za konkurs",
    inne: "inne",
  },
};

const commands = [
  new SlashCommandBuilder()
    .setName("drop")
    .setDescription("Wylosuj zniżkę na zakupy w sklepie!")
    .setDefaultMemberPermissions(null)
    .toJSON(),
  new SlashCommandBuilder()
    .setName("free-kasa")
    .setDescription("Wylosuj darmową kasę (tylko właściciel, kanał free-kasa)")
    .setDefaultMemberPermissions(null)
    .toJSON(),
  new SlashCommandBuilder()
    .setName("panelkalkulator")
    .setDescription("Wyślij panel kalkulatora waluty na kanał")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .toJSON(),
  new SlashCommandBuilder()
    .setName("ticketpanel")
    .setDescription("Wyślij TicketPanel na kanał")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .toJSON(),
  new SlashCommandBuilder()
    .setName("ticket-zakoncz")
    .setDescription("Użyj tej komendy jeżeli będziesz chciał zakończyć ticket (sprzedawca)")
    .setDefaultMemberPermissions(null)
    .addStringOption((option) =>
      option
        .setName("typ")
        .setDescription("Typ transakcji")
        .setRequired(true)
        .addChoices(
          { name: "ZAKUP", value: "zakup" },
          { name: "SPRZEDAŻ", value: "sprzedaż" },
          { name: "WRĘCZYŁ NAGRODĘ", value: "wręczył nagrodę" }
        )
    )
    .addStringOption((option) =>
      option
        .setName("ile")
        .setDescription("Kwota transakcji (np. 22,5k, 50k, 200k)")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("serwer")
        .setDescription("Nazwa serwera (np. anarchia lf)")
        .setRequired(true)
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("zamknij-z-powodem")
    .setDescription("Zamknij ticket z powodem (tylko właściciel)")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addStringOption((option) =>
      option
        .setName("powod")
        .setDescription("Powód zamknięcia")
        .setRequired(true)
        .addChoices(
          { name: "Brak odpowiedzi", value: "Brak odpowiedzi" },
          { name: "Fake ticket", value: "Fake ticket" },
          { name: "Próba oszustwa", value: "Próba oszustwa" },
          { name: "Brak kultury", value: "Brak kultury" },
          { name: "Spam", value: "Spam" },
          { name: "Zamówienie zrealizowane", value: "Zamówienie zrealizowane" },
          { name: "Inny powód", value: "Inny powód" }
        )
    )
    .addStringOption((option) =>
      option
        .setName("powod_custom")
        .setDescription("Własny powód zamknięcia")
        .setRequired(false)
        .setMaxLength(200)
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("legit-rep-ustaw")
    .setDescription("Ustaw licznik legit repów i zmień nazwę kanału")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addIntegerOption((option) =>
      option
        .setName("ile")
        .setDescription("Liczba legit repów (0-9999)")
        .setRequired(true)
        .setMinValue(0)
        .setMaxValue(9999)
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("help")
    .setDescription("Spis podstawowych komend bota")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("zaproszeniastats")
    .setDescription("Edytuj statystyki zaproszeń")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addStringOption((o) =>
      o
        .setName("kategoria")
        .setDescription(
          "Wybierz kategorię: prawdziwe / opuszczone / mniej4mies / dodatkowe",
        )
        .setRequired(true)
        .addChoices(
          { name: "prawdziwe", value: "prawdziwe" },
          { name: "opuszczone", value: "opuszczone" },
          { name: "mniej4mies", value: "mniej4mies" },
          { name: "dodatkowe", value: "dodatkowe" },
        ),
    )
    .addStringOption((o) =>
      o
        .setName("akcja")
        .setDescription("dodaj / odejmij / ustaw / wyczysc")
        .setRequired(true)
        .addChoices(
          { name: "dodaj", value: "dodaj" },
          { name: "odejmij", value: "odejmij" },
          { name: "ustaw", value: "ustaw" },
          { name: "wyczysc", value: "wyczysc" },
        ),
    )
    .addIntegerOption((o) =>
      o
        .setName("liczba")
        .setDescription("Ilość (opcjonalnie)")
        .setRequired(false),
    )
    .addUserOption((o) =>
      o
        .setName("komu")
        .setDescription("Dla kogo (opcjonalnie)")
        .setRequired(false),
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("zamknij")
    .setDescription("Zamknij ticket")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .toJSON(),
  new SlashCommandBuilder()
    .setName("panelweryfikacja")
    .setDescription("Wyślij panel weryfikacji na kanał")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .toJSON(),
  new SlashCommandBuilder()
    .setName("opinia")
    .setDescription("Podziel sie opinią o naszym sklepie!")
    .addIntegerOption((option) =>
      option
        .setName("czas_oczekiwania")
        .setDescription("Ocena dotycząca czasu oczekiwania (1-5 gwiazdek)")
        .setRequired(true)
        .addChoices(
          { name: "⭐", value: 1 },
          { name: "⭐ ⭐", value: 2 },
          { name: "⭐ ⭐ ⭐", value: 3 },
          { name: "⭐ ⭐ ⭐ ⭐", value: 4 },
          { name: "⭐ ⭐ ⭐ ⭐ ⭐", value: 5 },
        ),
    )
    .addIntegerOption((option) =>
      option
        .setName("jakosc_produktu")
        .setDescription("Ocena jakości produktu (1-5)")
        .setRequired(true)
        .addChoices(
          { name: "⭐", value: 1 },
          { name: "⭐ ⭐", value: 2 },
          { name: "⭐ ⭐ ⭐", value: 3 },
          { name: "⭐ ⭐ ⭐ ⭐", value: 4 },
          { name: "⭐ ⭐ ⭐ ⭐ ⭐", value: 5 },
        ),
    )
    .addIntegerOption((option) =>
      option
        .setName("cena_produktu")
        .setDescription("Ocena ceny produktu (1-5)")
        .setRequired(true)
        .addChoices(
          { name: "⭐", value: 1 },
          { name: "⭐ ⭐", value: 2 },
          { name: "⭐ ⭐ ⭐", value: 3 },
          { name: "⭐ ⭐ ⭐ ⭐", value: 4 },
          { name: "⭐ ⭐ ⭐ ⭐ ⭐", value: 5 },
        ),
    )
    .addStringOption((option) =>
      option
        .setName("tresc_opinii")
        .setDescription("Treść opinii")
        .setRequired(true),
    )
    .toJSON(),
  // NEW: /wyczysckanal command
  new SlashCommandBuilder()
    .setName("wyczysc")
    .setDescription(
      "Wyczyść wiadomości na kanale (wszystko / ilosc-wiadomosci)",
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addStringOption((option) =>
      option
        .setName("tryb")
        .setDescription("Wybierz tryb: wszystko lub ilosc")
        .setRequired(true)
        .addChoices(
          { name: "Wszystko", value: "wszystko" },
          { name: "Ilość wiadomości", value: "ilosc" },
        ),
    )
    .addIntegerOption((option) =>
      option
        .setName("ilosc")
        .setDescription(
          "Ile wiadomości usunąć (1-100) — wymagane gdy tryb=ilosc",
        )
        .setRequired(false),
    )
    .toJSON(),
  // NEW: /resetlc command - reset legitcheck counter
  new SlashCommandBuilder()
    .setName("resetlc")
    .setDescription("Reset liczby legitchecków do zera")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .toJSON(),
  // NEW: /zresetujczasoczekiwania command - clear cooldowns for drop/opinia/info
  new SlashCommandBuilder()
    .setName("zco")
    .setDescription("Zresetuj czas oczekiwania (/drop /opinia /sprawdz-zaproszenia /+rep)")
    .addStringOption((option) =>
      option
        .setName("co")
        .setDescription("Co zresetować")
        .setRequired(true)
        .addChoices(
          { name: "/drop", value: "drop" },
          { name: "/opinia", value: "opinia" },
          { name: "/sprawdz-zaproszenia", value: "zaproszenia" },
          { name: "+rep", value: "rep" },
          { name: "wszystko", value: "all" }
        ),
    )
    .addUserOption((option) =>
      option
        .setName("kto")
        .setDescription("Użytkownik do resetu (domyślnie Ty)")
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .toJSON(),
  // NEW helper admin commands for claiming/unclaiming
  new SlashCommandBuilder()
    .setName("przejmij")
    .setDescription("Przejmij aktualny ticket (sprzedawca)")
    .setDefaultMemberPermissions(null)
    .toJSON(),
  new SlashCommandBuilder()
    .setName("odprzejmij")
    .setDescription("Zwolnij aktualny ticket (sprzedawca)")
    .setDefaultMemberPermissions(null)
    .toJSON(),
  new SlashCommandBuilder()
    .setName("autoprzejmij")
    .setDescription("Automatyczne przejmowanie ticketow zakupowych (wlacz/wylacz)")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((option) =>
      option
        .setName("status")
        .setDescription("Wlacz lub wylacz autoprzejmowanie")
        .setRequired(true)
        .addChoices(
          { name: "WLACZ", value: "wlacz" },
          { name: "WYLACZ", value: "wylacz" }
        )
    )
    .toJSON(),
  // UPDATED: embed (interactive flow)
  new SlashCommandBuilder()
    .setName("embed")
    .setDescription("Wyślij wiadomość przez bota (tylko właściciel)")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addChannelOption((o) =>
      o
        .setName("kanal")
        .setDescription(
          "Kanał docelowy (opcjonalnie). Jeśli nie podasz, użyty zostanie aktualny kanał.",
        )
        .setRequired(false)
        .addChannelTypes(ChannelType.GuildText),
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("mody")
    .setDescription("Wyślij embed z przyciskiem do nagrań modów (tylko właściciel)")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addChannelOption((o) =>
      o
        .setName("kanal")
        .setDescription(
          "Kanał docelowy (opcjonalnie). Jeśli nie podasz, użyty zostanie aktualny kanał.",
        )
        .setRequired(false)
        .addChannelTypes(ChannelType.GuildText),
    )
    .toJSON(),
  // RENAMED: sprawdz-zaproszenia (was sprawdz-zapro)
  new SlashCommandBuilder()
    .setName("sprawdz-zaproszenia")
    .setDescription("Sprawdź ile posiadasz zaproszeń")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("rozliczenie")
    .setDescription("Dodaj kwote do rozliczeń (sprzedawca)")
    .setDefaultMemberPermissions(null)
    .addIntegerOption((option) =>
      option
        .setName("kwota")
        .setDescription("Kwota w zł")
        .setRequired(true)
    )
    .addUserOption((option) =>
      option
        .setName("uzytkownik")
        .setDescription("Użytkownik (opcjonalnie, domyślnie ty)")
        .setRequired(false)
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("rozliczeniazaplacil")
    .setDescription("Oznacz rozliczenie jako zapłacone (tylko właściciel)")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addUserOption((option) =>
      option
        .setName("uzytkownik")
        .setDescription("Użytkownik do oznaczenia")
        .setRequired(true)
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("rozliczeniezakoncz")
    .setDescription("Wyślij podsumowanie rozliczeń (tylko właściciel)")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .toJSON(),
  new SlashCommandBuilder()
    .setName("wezwij")
    .setDescription("Wezwij osobe (sprzedawca)")
    .setDefaultMemberPermissions(null)
    .toJSON(),
  new SlashCommandBuilder()
    .setName("statusbota")
    .setDescription("Pokaż szczegółowy status bota")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .toJSON(),
  new SlashCommandBuilder()
    .setName("rozliczenieustaw")
    .setDescription("Ustaw tygodniową sumę rozliczenia dla użytkownika (tylko właściciel)")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addUserOption((option) =>
      option
        .setName("uzytkownik")
        .setDescription("Użytkownik")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("akcja")
        .setDescription("Dodaj lub odejmij kwotę")
        .setRequired(true)
        .addChoices(
          { name: "Dodaj", value: "dodaj" },
          { name: "Odejmij", value: "odejmij" },
          { name: "Ustaw", value: "ustaw" }
        )
    )
    .addIntegerOption((option) =>
      option
        .setName("kwota")
        .setDescription("Kwota do dodania/odejmowania/ustawienia")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(999999)
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("utworz-konkurs")
    .setDescription(
      "Utwórz konkurs z przyciskiem do udziału i losowaniem zwycięzców",
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .toJSON(),
  new SlashCommandBuilder()
    .setName("end-giveaways")
    .setDescription("Zakończ wszystkie aktywne konkursy (tylko właściciel serwera)")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .toJSON(),
];

const rest = new REST({ version: "10" }).setToken(process.env.BOT_TOKEN);

// Helper: human-readable ms
function humanizeMs(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function isHttpUrl(value) {
  try {
    const u = new URL((value || "").trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeDiscordCdnVideoUrl(rawUrl) {
  const value = (rawUrl || "").toString().trim();
  if (!isHttpUrl(value)) return value;
  try {
    const u = new URL(value);
    const host = u.hostname.toLowerCase();
    const isDiscordCdn =
      host.endsWith("discordapp.com") || host.endsWith("discord.com");
    const isAttachmentPath = u.pathname.includes("/attachments/");
    if (isDiscordCdn && isAttachmentPath) {
      return `${u.protocol}//${u.host}${u.pathname}`;
    }
    return value;
  } catch {
    return value;
  }
}

function isVideoAttachment(att) {
  if (!att) return false;
  const ct = (att.contentType || "").toLowerCase();
  if (ct.startsWith("video/")) return true;

  const name = (att.name || "").toLowerCase();
  return (
    name.endsWith(".mp4") ||
    name.endsWith(".mov") ||
    name.endsWith(".webm") ||
    name.endsWith(".m4v") ||
    name.endsWith(".mkv") ||
    name.endsWith(".avi")
  );
}

function getModsVideoCandidateFilenames(videoCfg) {
  if (!videoCfg || typeof videoCfg !== "object") return [];

  const rawCandidates = [];
  if (videoCfg.filename) rawCandidates.push(videoCfg.filename);
  if (Array.isArray(videoCfg.filenameAliases)) {
    rawCandidates.push(...videoCfg.filenameAliases);
  }

  const unique = [];
  const seen = new Set();
  for (const raw of rawCandidates) {
    const name = (raw || "").toString().trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(name);
  }
  return unique;
}

function getNormalizedVideoStem(value) {
  return (value || "")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/\.[^.]+$/, "")
    .replace(/\s*\(\d+\)$/, "");
}

function resolveLocalModsVideoPath(videoCfg) {
  if (!videoCfg || typeof videoCfg !== "object") return null;

  const candidates = [];
  for (const filename of getModsVideoCandidateFilenames(videoCfg)) {
    candidates.push(path.join(__dirname, "attached_assets", filename));
  }
  if (videoCfg.localPath) {
    candidates.push(videoCfg.localPath);
  }

  const seen = new Set();
  for (const candidate of candidates) {
    const p = (candidate || "").toString().trim();
    if (!p) continue;
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (fs.existsSync(p)) return p;
  }

  return null;
}

function getModsVideoConfigByFilename(filename) {
  const normalized = (filename || "").toString().trim().toLowerCase();
  if (!normalized) return null;

  const normalizedNoExt = getNormalizedVideoStem(normalized);

  for (const cfg of MODS_VIDEO_FILES) {
    const candidateNames = getModsVideoCandidateFilenames(cfg);
    for (const candidateNameRaw of candidateNames) {
      const candidateName = candidateNameRaw.toLowerCase();
      const candidateStem = getNormalizedVideoStem(candidateName);
      if (
        normalized === candidateName ||
        normalizedNoExt === candidateStem ||
        normalizedNoExt.startsWith(candidateStem) ||
        candidateStem.startsWith(normalizedNoExt)
      ) {
        return cfg;
      }
    }
  }

  return null;
}

function getModsVideoCaption(videoCfg, fallbackName = "Nagranie") {
  const arrowEmoji = "<a:arrowwhite:1469100658606211233>";
  const safeName = (videoCfg?.modName || fallbackName)
    .toString()
    .replace(/[\r\n`*_~|<>]/g, "")
    .trim();
  const modName = safeName || "Nagranie";
  return `${arrowEmoji} **Mod:** __**${modName}**__`;
}

function getModsVideoOrderRank(videoCfg) {
  const key = videoCfg?.key;
  if (!key) return Number.MAX_SAFE_INTEGER;
  return modsVideoOrderRanks.has(key)
    ? modsVideoOrderRanks.get(key)
    : Number.MAX_SAFE_INTEGER;
}

function collectVideoLinksFromMessage(msg) {
  const out = [];
  if (!msg?.attachments?.size) return out;

  for (const att of msg.attachments.values()) {
    if (!isVideoAttachment(att)) continue;
    const normalizedUrl = normalizeDiscordCdnVideoUrl(att.url);
    if (!isHttpUrl(normalizedUrl)) continue;
    const cfg = getModsVideoConfigByFilename(att.name || "");
    out.push({
      label: att.name || "nagranie",
      key: cfg?.key || null,
      modName: cfg?.modName || null,
      url: normalizedUrl,
    });
  }
  return out;
}

function getPublicBaseUrl() {
  const candidates = [
    process.env.PUBLIC_BASE_URL,
    process.env.MONITOR_HTTP_URL,
    process.env.RENDER_EXTERNAL_URL,
    process.env.RENDER_URL,
  ];

  for (const raw of candidates) {
    const value = (raw || "").trim();
    if (!value) continue;
    try {
      const parsed = new URL(value);
      return `${parsed.protocol}//${parsed.host}`;
    } catch {
      // ignore invalid URL candidate
    }
  }

  const host = (process.env.RENDER_EXTERNAL_HOSTNAME || "").trim();
  if (host) {
    return `https://${host}`;
  }

  return null;
}

function getLocalModsVideoPublicUrl(videoCfg) {
  if (!videoCfg?.key) return null;
  const localPath = resolveLocalModsVideoPath(videoCfg);
  if (!localPath) return null;

  const baseUrl = getPublicBaseUrl();
  if (!baseUrl) return null;

  return `${baseUrl}/videos/${encodeURIComponent(videoCfg.key)}`;
}

async function findVideoAttachmentUrlByName(guild, filenames) {
  const list = Array.isArray(filenames) ? filenames : [filenames];
  const filenameLowerList = list
    .map((f) => (f || "").toString().trim().toLowerCase())
    .filter(Boolean);
  if (!guild || filenameLowerList.length === 0) return null;

  const filenameStemList = filenameLowerList.map((f) => getNormalizedVideoStem(f));
  const meRef = guild.members?.me || client.user?.id || null;
  const channels = guild.channels.cache.filter(
    (ch) => ch.type === ChannelType.GuildText,
  );

  // Limit scan scope to keep this interaction responsive.
  for (const channel of channels.values()) {
    try {
      const perms = meRef ? channel.permissionsFor(meRef) : null;
      if (
        !perms ||
        !perms.has(PermissionFlagsBits.ViewChannel) ||
        !perms.has(PermissionFlagsBits.ReadMessageHistory)
      ) {
        continue;
      }

      const fetched = await channel.messages.fetch({ limit: 100 }).catch(() => null);
      if (!fetched) continue;

      for (const msg of fetched.values()) {
        for (const att of msg.attachments.values()) {
          const attName = (att.name || "").toLowerCase();
          const attStem = getNormalizedVideoStem(attName);
          const matchesName =
            filenameLowerList.some(
              (filenameLower) =>
                attName === filenameLower ||
                attName.startsWith(filenameLower.replace(/\.[^.]+$/, "")),
            ) ||
            filenameStemList.some(
              (filenameStem) =>
                attStem === filenameStem ||
                attStem.startsWith(filenameStem) ||
                filenameStem.startsWith(attStem),
            );
          if (!matchesName) continue;
          if (isHttpUrl(att.url)) {
            return att.url;
          }
        }
      }
    } catch {
      // ignore per-channel fetch errors
    }
  }

  return null;
}

async function resolveModsVideoUrl(guild, videoCfg, options = {}) {
  const allowSlowScan = options.allowSlowScan !== false;

  if (!videoCfg) return null;

  const fromEnv = normalizeDiscordCdnVideoUrl(
    (process.env[videoCfg.envVar] || "").trim(),
  );
  if (isHttpUrl(fromEnv)) {
    modsVideoUrlCache.set(videoCfg.key, fromEnv);
    return fromEnv;
  }

  const fromDefault = normalizeDiscordCdnVideoUrl(
    (videoCfg.defaultUrl || "").trim(),
  );
  if (isHttpUrl(fromDefault)) {
    modsVideoUrlCache.set(videoCfg.key, fromDefault);
    return fromDefault;
  }

  const cached = normalizeDiscordCdnVideoUrl(
    (modsVideoUrlCache.get(videoCfg.key) || "").trim(),
  );
  if (isHttpUrl(cached)) return cached;

  const localRouteUrl = getLocalModsVideoPublicUrl(videoCfg);
  if (isHttpUrl(localRouteUrl)) {
    modsVideoUrlCache.set(videoCfg.key, localRouteUrl);
    return localRouteUrl;
  }

  if (!allowSlowScan) {
    return null;
  }

  const found = await findVideoAttachmentUrlByName(
    guild,
    getModsVideoCandidateFilenames(videoCfg),
  );
  const normalizedFound = normalizeDiscordCdnVideoUrl(found);
  if (isHttpUrl(normalizedFound)) {
    modsVideoUrlCache.set(videoCfg.key, normalizedFound);
    return normalizedFound;
  }

  return null;
}

// Helper: sprawdź czy użytkownik jest admin lub sprzedawca
function isAdminOrSeller(member) {
  if (!member) return false;
  const SELLER_ROLE_ID = "1350786945944391733";

  // Sprawdź czy ma rolę sprzedawcy
  if (
    member.roles &&
    member.roles.cache &&
    member.roles.cache.has(SELLER_ROLE_ID)
  ) {
    return true;
  }

  // Sprawdź Administrator
  if (
    member.permissions &&
    member.permissions.has(PermissionFlagsBits.Administrator)
  ) {
    return true;
  }

  return false;
}

function parseShortNumber(input) {
  if (!input) return NaN;
  const str = input.toString().trim().toLowerCase().replace(/\s+/g, "");
  const match = str.match(/^(\d+)(k|m)?$/);
  if (!match) return NaN;
  const base = parseInt(match[1], 10);
  const suffix = match[2];
  if (!suffix) return base;
  if (suffix === "k") return base * 1000;
  if (suffix === "m") return base * 1_000_000;
  return NaN;
}

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function formatShortWaluta(n) {
  const v = Number(n) || 0;
  const abs = Math.abs(v);
  const fmt = (x) => {
    const rounded = Math.round((Number(x) + Number.EPSILON) * 100) / 100;
    if (Number.isInteger(rounded)) return `${rounded}`;
    return `${rounded}`.replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
  };

  if (abs >= 1_000_000) return `${fmt(v / 1_000_000)}m`;
  if (abs >= 1_000) return `${fmt(v / 1_000)}k`;
  return `${Math.floor(v)}`;
}

function getPaymentFeePercent(methodRaw) {
  const m = (methodRaw || "").toString().trim().toLowerCase();

  if (m.startsWith("blik")) return 0;
  if (m.startsWith("kod blik")) return 10;
  if (m.includes("mypsc")) return 20;
  if (m === "psc bez paragonu" || m.startsWith("psc bez paragonu")) return 20;
  if (m === "psc" || m.startsWith("psc ")) return 10;
  if (m.includes("paypal")) return 5;
  if (m.includes("ltc")) return 5;

  return 0;
}

function getMinPurchasePln(methodRaw) {
  const m = (methodRaw || "").toString().trim().toLowerCase();
  if (m.includes("mypsc")) return 11; // min zakupy dla MYPSC
  if (m.startsWith("blik") || m.startsWith("kod blik")) return 5;
  if (m.includes("psc")) return 5;
  if (m.includes("paypal")) return 5;
  if (m.includes("ltc")) return 5;
  return 5;
}

function calculateFeePln(basePln, methodRaw) {
  const percent = getPaymentFeePercent(methodRaw);
  let fee = basePln * (percent / 100);
  let feeLabel = `${percent}%`;

  if ((methodRaw || "").toString().toLowerCase().includes("mypsc")) {
    fee = Math.max(fee, 10); // min 10 zł
    feeLabel = `${percent}% (min 10zł)`;
  }

  return { fee, feeLabel, percent };
}

function getRateForPlnAmount(pln, serverRaw) {
  const server = (serverRaw || "").toString().trim().toUpperCase();

  if (server === "ANARCHIA_BOXPVP") return 650000;
  if (server === "ANARCHIA_LIFESTEAL") {
    if (Number(pln) >= 100) return 5000;
    return 4500;
  }
  if (server === "PYK_MC") {
    if (Number(pln) >= 100) return 4000;
    return 3500;
  }

  // fallback (stary cennik)
  if (Number(pln) >= 100) return 5000;
  return 4500;
}

// Helper: find a bot message in a channel matching a predicate on embed
async function findBotMessageWithEmbed(channel, matchFn) {
  try {
    const fetched = await channel.messages.fetch({ limit: 100 });
    for (const msg of fetched.values()) {
      if (
        msg.author?.id === client.user.id &&
        msg.embeds &&
        msg.embeds.length
      ) {
        const emb = msg.embeds[0];
        try {
          if (matchFn(emb)) return msg;
        } catch (e) {
          // match function error — skip
        }
      }
    }
  } catch (e) {
    // ignore fetch errors (no perms)
  }
  return null;
}

// Helper: determine if a channel is considered a ticket channel (based on categories)
function isTicketChannel(channel) {
  if (!channel || !channel.guild) return false;
  if (channel.parentId && String(channel.parentId) === String(REWARDS_CATEGORY_ID))
    return true;
  const cats = ticketCategories.get(channel.guild.id);
  if (cats) {
    for (const id of Object.values(cats)) {
      if (id === channel.parentId) return true;
    }
  }
  // fallback: name starts with ticket-
  if (channel.name && channel.name.toLowerCase().startsWith("ticket-"))
    return true;
  return false;
}

// Helper: rebuild/edit ticket message components to reflect claim/unclaim state in a safe manner
async function editTicketMessageButtons(channel, messageId, claimerId = null) {
  try {
    const ch = channel;
    if (!ch) return;
    const msg = await ch.messages.fetch(messageId).catch(() => null);
    if (!msg) return;

    // Check if this is a rewards ticket
    const isRewardsTicket = ch.parentId && String(ch.parentId) === String(REWARDS_CATEGORY_ID);

    const newRows = [];

    for (const row of msg.components) {
      const newRow = new ActionRowBuilder();
      const comps = [];

      for (const comp of row.components) {
        const cid = comp.customId || "";
        const label = comp.label || null;
        const style = comp.style || ButtonStyle.Secondary;
        const emoji = comp.emoji || null;
        const disabledOrig = !!comp.disabled;

        // Normalize known ticket button types
        if (cid.startsWith("ticket_claim_")) {
          if (claimerId) {
            // show disabled claim to indicate taken
            comps.push(
              new ButtonBuilder()
                .setCustomId(
                  `ticket_claim_${cid.split("_").slice(2).join("_")}`,
                )
                .setLabel("Przejmij")
                .setStyle(isRewardsTicket ? ButtonStyle.Secondary : ButtonStyle.Secondary)
                .setDisabled(true),
            );
          } else {
            comps.push(
              new ButtonBuilder()
                .setCustomId(cid)
                .setLabel("Przejmij")
                .setStyle(isRewardsTicket ? ButtonStyle.Secondary : ButtonStyle.Secondary)
                .setDisabled(false),
            );
          }
        } else if (cid.startsWith("ticket_unclaim_")) {
          const channelIdPart = cid.split("_")[2] || "";
          if (claimerId) {
            // enable unclaim for this claimer (customId includes claimerId)
            comps.push(
              new ButtonBuilder()
                .setCustomId(`ticket_unclaim_${channelIdPart}_${claimerId}`)
                .setLabel("Odprzejmij")
                .setStyle(isRewardsTicket ? ButtonStyle.Secondary : ButtonStyle.Danger)
                .setDisabled(false),
            );
          } else {
            // disabled unclaim
            comps.push(
              new ButtonBuilder()
                .setCustomId(`ticket_unclaim_${channelIdPart}`)
                .setLabel("Odprzejmij")
                .setStyle(isRewardsTicket ? ButtonStyle.Secondary : ButtonStyle.Secondary)
                .setDisabled(true),
            );
          }
        } else {
          // keep other buttons as-is (close/settings/code). Recreate them to avoid component reuse issues.
          if (cid) {
            try {
              const btn = new ButtonBuilder()
                .setCustomId(cid)
                .setLabel(label || "")
                .setStyle(style)
                .setDisabled(disabledOrig);
              if (emoji) btn.setEmoji(emoji);
              comps.push(btn);
            } catch (e) {
              // fallback: skip component if something unexpected
            }
          } else {
            // non-interactive component (unlikely) — skip
          }
        }
      }

      try {
        newRow.addComponents(...comps);
        newRows.push(newRow);
      } catch (e) {
        // if row overflows, fallback to original row
        newRows.push(row);
      }
    }

    // Edit message with new rows
    await msg.edit({ components: newRows }).catch(() => null);
  } catch (err) {
    console.error("editTicketMessageButtons error:", err);
  }
}

async function registerCommands() {
  try {
    console.log("Rejestrowanie slash commands...");

    // Prefer ustawienie BOT_ID przez zmienną środowiskową
    const BOT_ID = process.env.DISCORD_BOT_ID || "1449397101032112139";

    // Rejestruj komendy na konkretnym serwerze (szybsze, natychmiastowe)
    try {
      await rest.put(
        Routes.applicationGuildCommands(BOT_ID, DEFAULT_GUILD_ID),
        {
          body: commands,
        },
      );
      console.log(`Komendy zarejestrowane dla guild ${DEFAULT_GUILD_ID}`);
    } catch (e) {
      console.warn(
        "Nie udało się zarejestrować komend na serwerze:",
        e.message || e,
      );
    }

    // Opcjonalnie: rejestruj globalnie tylko gdy jawnie to włączysz (globalne propagują się długo)
    if (process.env.REGISTER_GLOBAL === "true") {
      try {
        // Krótka przerwa żeby Discord mógł przepuścić zmiany (opcjonalne)
        await new Promise((r) => setTimeout(r, 1500));
        await rest.put(Routes.applicationCommands(BOT_ID), {
          body: commands,
        });
        console.log("Globalne slash commands zarejestrowane!");
      } catch (e) {
        console.warn(
          "Nie udało się zarejestrować globalnych komend:",
          e.message || e,
        );
      }
    } else {
      console.log(
        "Pominięto rejestrację globalnych komend (ustaw REGISTER_GLOBAL=true aby włączyć).",
      );
    }
  } catch (error) {
    console.error("Błąd rejestracji komend:", error);
  }
}

// improved apply defaults (tries to find resources by name / fallback)
async function applyDefaultsForGuild(guildId) {
  try {
    const guild =
      client.guilds.cache.get(guildId) || (await client.guilds.fetch(guildId));
    if (!guild) return;

    const normalize = (s = "") =>
      s
        .toString()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9 ]/gi, "")
        .trim()
        .toLowerCase();

    // find opinie channel by name
    const opinie = guild.channels.cache.find(
      (c) =>
        c.type === ChannelType.GuildText &&
        (c.name === "⭐-×┃opinie-klientow" ||
          normalize(c.name).includes("opinie") ||
          normalize(c.name).includes("opinie-klientow")),
    );
    if (opinie) {
      opinieChannels.set(guildId, opinie.id);
      console.log(`Ustawiono domyślny kanał opinii: ${opinie.id}`);
    }

    // find drop channel by name
    const drop = guild.channels.cache.find(
      (c) =>
        c.type === ChannelType.GuildText &&
        (c.name === DEFAULT_NAMES.dropChannelName ||
          normalize(c.name) === normalize(DEFAULT_NAMES.dropChannelName)),
    );
    if (drop) {
      dropChannels.set(guildId, drop.id);
      console.log(`Ustawiono domyślny kanał drop: ${drop.id}`);
    }

    // find verification role by exact name OR fallback to searching for "klient"
    let role =
      guild.roles.cache.find(
        (r) => r.name === DEFAULT_NAMES.verificationRoleName,
      ) ||
      guild.roles.cache.find((r) =>
        normalize(r.name).includes(normalize("klient")),
      );

    if (role) {
      verificationRoles.set(guildId, role.id);
      scheduleSavePersistentState();
      console.log(
        `Ustawiono domyślną rolę weryfikacji: ${role.id} (${role.name})`,
      );
    } else {
      console.log(
        `Nie znaleziono domyślnej roli weryfikacji w guild ${guildId}. Szukana nazwa: "${DEFAULT_NAMES.verificationRoleName}" lub zawierająca "klient".`,
      );
    }

    // find and set ticket categories (by name or normalized fallback)
    const categoriesMap = {};
    for (const key of Object.keys(DEFAULT_NAMES.categories)) {
      const catName = DEFAULT_NAMES.categories[key];
      const cat = guild.channels.cache.find(
        (c) =>
          c.type === ChannelType.GuildCategory &&
          (c.name === catName ||
            normalize(c.name).includes(normalize(catName))),
      );
      if (cat) {
        categoriesMap[key] = cat.id;
        console.log(`Ustawiono kategorię ${key} -> ${cat.id}`);
      }
    }
    if (Object.keys(categoriesMap).length > 0) {
      ticketCategories.set(guildId, categoriesMap);
    }
  } catch (error) {
    console.error("Błąd ustawiania domyślnych zasobów:", error);
  }
}

client.once(Events.ClientReady, async (c) => {
  console.log(`[READY] Bot zalogowany jako ${c.user.tag}`);
  console.log(`[READY] Bot jest na ${c.guilds.cache.size} serwerach`);
  console.log(`[READY] Bot jest online i gotowy do pracy!`);
  
  // loadPersistentState() już wywołane na początku pliku

  // --- Webhook startowy do Discorda ---
  try {
    const webhookUrl = process.env.UPTIME_WEBHOOK;
    if (webhookUrl) {
      await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: `🟢 Bot **${c.user.tag}** został uruchomiony i działa poprawnie.`
        })
      });
      console.log("Wysłano webhook startowy.");
    } else {
      console.log("Brak UPTIME_WEBHOOK w zmiennych środowiskowych.");
    }
  } catch (err) {
    console.error("Błąd wysyłania webhooka startowego:", err);
  }

  // Ustaw status - gra w NewShop
  try {
    c.user.setActivity(`LegitRepy: ${legitRepCount} 🛒`, { type: 0 });
    setInterval(
      () => c.user.setActivity(`LegitRepy: ${legitRepCount} 🛒`, { type: 0 }),
      60000,
    );
  } catch (e) {
    // aktywność może być niedostępna na bocie, ignoruj błąd
  }

  await registerCommands();

  // try to apply defaults on the provided server id
  await applyDefaultsForGuild(DEFAULT_GUILD_ID);

  // also apply defaults for all cached guilds (if names match)
  client.guilds.cache.forEach((g) => {
    applyDefaultsForGuild(g.id).catch((e) => console.error(e));
  });

  // Read current rep count from channel name
  try {
    const repChannel = await c.channels.fetch(REP_CHANNEL_ID).catch(() => null);
    if (repChannel && repChannel.name) {
      const match = repChannel.name.match(/➔(\d+)$/);
      if (match) {
        legitRepCount = parseInt(match[1], 10);
        console.log(`Odczytano liczbę repów z kanału: ${legitRepCount}`);
        scheduleSavePersistentState();
      }
    }

    // Try to find previously sent rep info message so we can reuse it
    if (repChannel) {
      const found = await findBotMessageWithEmbed(repChannel, (emb) => {
        return (
          emb.description &&
          typeof emb.description === "string" &&
          emb.description.includes("New Shop × LEGIT CHECK")
        );
      });
      if (found) {
        repLastInfoMessage.set(repChannel.id, found.id);
        console.log(
          `[ready] Znalazłem istniejącą wiadomość info-rep: ${found.id}`,
        );
      }
    }

    // Try to find previously sent opinion instruction messages in cached guilds
    client.guilds.cache.forEach(async (g) => {
      const opinId = opinieChannels.get(g.id);
      if (opinId) {
        try {
          const ch = await client.channels.fetch(opinId).catch(() => null);
          if (ch) {
            const found = await findBotMessageWithEmbed(
              ch,
              (emb) =>
                typeof emb.description === "string" &&
                (emb.description.includes(
                  "Użyj **komendy** </opinia:1464015495392133321>",
                ) ||
                  emb.description.includes("Użyj **komendy** `/opinia`")),
            );
            if (found) {
              lastOpinionInstruction.set(ch.id, found.id);
              console.log(
                `[ready] Znalazłem istniejącą instrukcję opinii: ${found.id} w kanale ${ch.id}`,
              );
            }
          }
        } catch (e) {
          // ignore
        }
      }

      // Try to find previously sent drop instruction messages
      const dropId = dropChannels.get(g.id);
      if (dropId) {
        try {
          const chd = await client.channels.fetch(dropId).catch(() => null);
          if (chd) {
            const foundDrop = await findBotMessageWithEmbed(
              chd,
              (emb) =>
                typeof emb.description === "string" &&
                emb.description.includes("Użyj **komendy** </drop:1464015494876102748>"),
            );
            if (foundDrop) {
              lastDropInstruction.set(chd.id, foundDrop.id);
              scheduleSavePersistentState();
              console.log(
                `[ready] Znalazłem istniejącą instrukcję drop: ${foundDrop.id} w kanale ${chd.id}`,
              );
            }
          }
        } catch (e) {
          // ignore
        }
      }

      // Try to find previously sent invite instruction messages (zaproszenia)
      try {
        const zapCh =
          g.channels.cache.find(
            (c) =>
              c.type === ChannelType.GuildText &&
              (c.name === "📨-×┃zaproszenia" ||
                c.name.toLowerCase().includes("zaproszen") ||
                c.name.toLowerCase().includes("zaproszenia")),
          ) || null;
        if (zapCh) {
          // First try to use saved message ID from file
          const savedId = lastInviteInstruction.get(zapCh.id);
          let foundExisting = false;
          if (savedId) {
            try {
              const savedMsg = await zapCh.messages
                .fetch(savedId)
                .catch(() => null);
              if (savedMsg && savedMsg.author.id === client.user.id) {
                console.log(
                  `[ready] Używam zapisanej wiadomości informacyjnej: ${savedId} w kanale ${zapCh.id}`,
                );
                // Message exists, we're good
                foundExisting = true;
              }
            } catch (e) {
              // Message doesn't exist, try to find it
            }
          }

          // If saved message doesn't exist, try to find it by content
          if (!foundExisting) {
            const foundInvite = await findBotMessageWithEmbed(
              zapCh,
              (emb) =>
                typeof emb.description === "string" &&
                (emb.description.includes(
                  "Użyj **komendy** /sprawdz-zaproszenia",
                ) ||
                  emb.description.includes("sprawdz-zaproszenia")),
            );
            if (foundInvite) {
              lastInviteInstruction.set(zapCh.id, foundInvite.id);
              scheduleSavePersistentState();
              console.log(
                `[ready] Znalazłem istniejącą instrukcję zaproszeń: ${foundInvite.id} w kanale ${zapCh.id}`,
              );
            }
          }
        }
      } catch (e) {
        // ignore
      }
    });
  } catch (err) {
    console.error(
      "Błąd odczytywania licznika repów lub wyszukiwania wiadomości:",
      err,
    );
  }

  // Initialize invite cache for all guilds
  client.guilds.cache.forEach(async (guild) => {
    try {
      const invites = await guild.invites.fetch().catch(() => null);
      if (!invites) return;
      const map = new Map();
      invites.each((inv) => map.set(inv.code, inv.uses));
      guildInvites.set(guild.id, map);
      // ensure inviteCounts map exists
      if (!inviteCounts.has(guild.id)) inviteCounts.set(guild.id, new Map());
      if (!inviteRewards.has(guild.id)) inviteRewards.set(guild.id, new Map());
      if (!inviteRewardsGiven.has(guild.id))
        inviteRewardsGiven.set(guild.id, new Map()); // NEW
      if (!inviterRateLimit.has(guild.id))
        inviterRateLimit.set(guild.id, new Map());
      if (!inviteLeaves.has(guild.id)) inviteLeaves.set(guild.id, new Map());
      if (!inviteTotalJoined.has(guild.id)) inviteTotalJoined.set(guild.id, new Map());
      if (!inviteFakeAccounts.has(guild.id)) inviteFakeAccounts.set(guild.id, new Map());
      if (!inviteBonusInvites.has(guild.id)) inviteBonusInvites.set(guild.id, new Map());
      console.log(`[invites] Zainicjalizowano invites cache dla ${guild.id}`);
    } catch (err) {
      console.warn("[invites] Nie udało się pobrać invite'ów dla guild:", err);
    }
  });
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      await handleSlashCommand(interaction);
    } else if (interaction.isStringSelectMenu()) {
      await handleSelectMenu(interaction);
    } else if (interaction.isModalSubmit()) {
      await handleModalSubmit(interaction);
    } else if (interaction.isButton()) {
      await handleButtonInteraction(interaction);
    }
  } catch (error) {
    console.error("Błąd obsługi interakcji:", error);
  }
});

async function handleModalSubmit(interaction) {
  // Sprawdź czy interakcja już została odpowiedziana
  if (interaction.replied || interaction.deferred) return;
  
  const id = interaction.customId;

  // --- ILE OTRZYMAM ---
  if (id === "modal_ile_otrzymam") {
    const kwotaStr = interaction.fields.getTextInputValue("kwota");
    const tryb = interaction.fields.getTextInputValue("tryb");
    const metoda = interaction.fields.getTextInputValue("metoda");

    const kwota = Number(kwotaStr);
    if (isNaN(kwota) || kwota <= 0) {
      return interaction.reply({
        flags: [MessageFlags.Ephemeral],
        content: "> `❌` × Podaj **poprawną** kwotę w PLN.",
      });
    }

    if (kwota < 5) {
      return interaction.reply({
        flags: [MessageFlags.Ephemeral],
        content: "> `❌` × Minimalna kwota to **5zł** (MYPSC **11zł**).",
      });
    }

    if (kwota > 10_000) {
      return interaction.reply({
        flags: [MessageFlags.Ephemeral],
        content: "> `❌` × Maksymalna kwota to **10 000zł**.",
      });
    }

    const rate = getRateForPlnAmount(kwota, tryb);
    const feePercent = getPaymentFeePercent(metoda);

    const base = kwota * rate;
    const fee = base * (feePercent / 100);
    const finalAmount = Math.floor(base - fee);

    return interaction.reply({
      flags: [MessageFlags.Ephemeral],
      content:
        `💰 **Otrzymasz:** ${finalAmount.toLocaleString()}\n` +
        `📉 Kurs: ${rate}\n` +
        `💸 Prowizja: ${feePercent}%\n` +
        `📌 Tryb: ${tryb}\n` +
        `📌 Metoda: ${metoda}`,
    });
  }

  // --- ILE MUSZĘ DAĆ ---
  if (id === "modal_ile_musze_dac") {
    const walutaStr = interaction.fields.getTextInputValue("waluta");
    const tryb = interaction.fields.getTextInputValue("tryb");
    const metoda = interaction.fields.getTextInputValue("metoda");

    const amount = parseShortNumber(walutaStr);
    if (isNaN(amount) || amount <= 0) {
      return interaction.reply({
        flags: [MessageFlags.Ephemeral],
        content: "> `❌` × Podaj **poprawną** ilość waluty (np. 125k / 1m).",
      });
    }

    if (amount < 22_500) {
      return interaction.reply({
        flags: [MessageFlags.Ephemeral],
        content: "> `❌` × Minimalna ilość to **22,5k** waluty.",
      });
    }

    if (amount > 999_000_000) {
      return interaction.reply({
        flags: [MessageFlags.Ephemeral],
        content: "> `❌` × Maksymalna ilość to **999 000 000** waluty.",
      });
    }

    const rate = getRateForPlnAmount(100, tryb);
    const feePercent = getPaymentFeePercent(metoda);

    const plnBase = amount / rate;
    const fee = plnBase * (feePercent / 100);
    const finalPln = Number((plnBase + fee).toFixed(2));

    return interaction.reply({
      flags: [MessageFlags.Ephemeral],
      content:
        `💸 **Musisz zapłacić:** ${finalPln} PLN\n` +
        `📉 Kurs: ${rate}\n` +
        `💸 Prowizja: ${feePercent}%\n` +
        `📌 Tryb: ${tryb}\n` +
        `📌 Metoda: ${metoda}`,
    });
  }

  // --- INNE MODALE (TWOJE) ---
  // NEW: verification modal handling
  if (interaction.customId.startsWith("modal_verify_")) {
    const modalId = interaction.customId;
    const record = pendingVerifications.get(modalId);

    if (!record) {
      await interaction.reply({
        content:
          "> `❌` × **Nie mogę** znaleźć zapisanego zadania **weryfikacji** (spróbuj ponownie).",
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    if (record.userId !== interaction.user.id) {
      await interaction.reply({
        content:
          "> `❌` × **Tylko** użytkownik, który kliknął **przycisk**, może rozwiązać tę zagadkę.",
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    const answer = interaction.fields.getTextInputValue("verification_answer");
    const isCorrect = answer.toLowerCase().trim() === record.correctAnswer.toLowerCase().trim();

    if (isCorrect) {
      try {
        // Dodaj rolę weryfikacji
        const member = await interaction.guild.members.fetch(interaction.user.id);
        await member.roles.add(record.roleId);

        // Wyślij embed potwierdzający
        const embed = new EmbedBuilder()
          .setColor(0x00ff00)
          .setTitle("✅ Weryfikacja pomyślna!")
          .setDescription(`Gratulacje! Pomyślnie przeszedłeś weryfikację.`)
          .setTimestamp();

        await interaction.reply({ embeds: [embed] });

        // Usuń z oczekujących
        pendingVerifications.delete(modalId);

        console.log(
          `Użytkownik ${interaction.user.username} przeszedł weryfikację na serwerze ${interaction.guild.id}`,
        );
      } catch (error) {
        console.error("Błąd przy nadawaniu roli po weryfikacji:", error);
        await interaction.reply({
          content: "> `❌` **Wystąpił błąd przy nadawaniu roli.**",
          flags: [MessageFlags.Ephemeral],
        });
      }
    } else {
      await interaction.reply({
        content: "> `❌` **Niepoprawna odpowiedź.** Spróbuj ponownie.",
        flags: [MessageFlags.Ephemeral],
      });
    }
    return;
  }

  // NEW: konkurs join modal
  if (interaction.customId.startsWith("konkurs_join_modal_")) {
    const msgId = interaction.customId.replace("konkurs_join_modal_", "");
    await handleKonkursJoinModal(interaction, msgId);
    return;
  }

  // KALKULATOR: ile otrzymam?
  if (interaction.customId === "modal_ile_otrzymam") {
    try {
      const kwotaStr = interaction.fields.getTextInputValue("kwota");
      const kwota = parseFloat(kwotaStr.replace(",", "."));

      if (isNaN(kwota) || kwota <= 0) {
        await interaction.reply({
          content: "> `❌` × Podaj **poprawną** kwotę w PLN.",
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }

      // globalne minimum: 5zł (MYPSC 11zł dalej w metodach)
      if (kwota < 5) {
        await interaction.reply({
          content: "> `❌` × Minimalna kwota to **5zł** (MYPSC **11zł**). Podaj większą kwotę.",
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }

      // maksymalnie 10 000 zł
      if (kwota > 10_000) {
        await interaction.reply({
          content: "> `❌` × Maksymalna kwota to **10 000zł**. Podaj mniejszą kwotę.",
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }

      // Zapisz kwotę i pokaż menu z wyborem trybu i metody
      const userId = interaction.user.id;
      kalkulatorData.set(userId, { kwota, typ: "otrzymam" });

      const trybSelect = new StringSelectMenuBuilder()
        .setCustomId("kalkulator_tryb")
        .setPlaceholder("Wybierz serwer...")
        .addOptions(
          { label: "ANARCHIA LIFESTEAL", value: "ANARCHIA_LIFESTEAL", emoji: { id: "1469444521308852324", name: "ANARCHIA_GG" } },
          { label: "ANARCHIA BOXPVP", value: "ANARCHIA_BOXPVP", emoji: { id: "1469444521308852324", name: "ANARCHIA_GG" } },
          { label: "PYK MC", value: "PYK_MC", emoji: { id: "1457113144412475635", name: "PYK_MC" } }
        );

      const metodaSelect = new StringSelectMenuBuilder()
        .setCustomId("kalkulator_metoda")
        .setPlaceholder("Wybierz metodę płatności...")
        .addOptions(
          { label: "BLIK", value: "BLIK", description: "Szybki przelew BLIK (0% prowizji)", emoji: { id: "1469107179234525184", name: "BLIK" } },
          { label: "Kod BLIK", value: "Kod BLIK", description: "Kod BLIK (10% prowizji)", emoji: { id: "1469107179234525184", name: "BLIK" } },
          { label: "PSC", value: "PSC", description: "Paysafecard (10% prowizji)", emoji: { id: "1469107238676467940", name: "PSC" } },
          { label: "PSC bez paragonu", value: "PSC bez paragonu", description: "Paysafecard bez paragonu (20% prowizji)", emoji: { id: "1469107238676467940", name: "PSC" } },
          { label: "MYPSC", value: "MYPSC", description: "MYPSC (20% lub min 10zł)", emoji: { id: "1469107199350669473", name: "MYPSC" } },
          { label: "PayPal", value: "PayPal", description: "PayPal (5% prowizji)", emoji: { id: "1449354427755659444", name: "PAYPAL" } },
          { label: "LTC", value: "LTC", description: "Litecoin (5% prowizji)", emoji: { id: "1449186363101548677", name: "LTC" } }
        );

      const embed = new EmbedBuilder()
        .setColor(COLOR_BLUE)
        .setDescription(
          "```\n" +
          "🔢 New Shop × Obliczanie\n" +
          "```\n" +
          `> 💵 × **Wybrana kwota:** \`${kwota.toFixed(2)}zł\`\n> ❗ × **Wybierz serwer i metodę płatności __poniżej:__`);

      await interaction.reply({
        embeds: [embed],
        components: [
          new ActionRowBuilder().addComponents(trybSelect),
          new ActionRowBuilder().addComponents(metodaSelect)
        ],
        flags: [MessageFlags.Ephemeral]
      });
    } catch (error) {
      console.error("Błąd w modal_ile_otrzymam:", error);
      await interaction.reply({
        content: "> `❌` × **Wystąpił** błąd podczas przetwarzania. Spróbuj **ponownie**.",
        flags: [MessageFlags.Ephemeral]
      });
    }
    return;
  }

  // KALKULATOR: ile muszę dać?
  if (interaction.customId === "modal_ile_musze_dac") {
    try {
      const walutaStr = interaction.fields.getTextInputValue("waluta");
      const waluta = parseShortNumber(walutaStr);

      if (!waluta || waluta <= 0 || waluta > 999_000_000) {
        await interaction.reply({
          content: "> `❌` × Podaj **poprawną** ilość waluty (1–999 000 000, możesz użyć k/m).",
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }

      // minimalne zakupy dla "ile muszę dać" = 22.5k
      if (waluta < 22_500) {
        await interaction.reply({
          content: "> `❌` × Minimalna ilość to **22,5k** waluty. Podaj większą wartość.",
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }

      // Zapisz walutę i pokaż menu z wyborem trybu i metody
      const userId = interaction.user.id;
      kalkulatorData.set(userId, { waluta, typ: "muszedac" });

      const trybSelect = new StringSelectMenuBuilder()
        .setCustomId("kalkulator_tryb")
        .setPlaceholder("Wybierz serwer...")
        .addOptions(
          { label: "ANARCHIA LIFESTEAL", value: "ANARCHIA_LIFESTEAL", emoji: { id: "1469444521308852324", name: "ANARCHIA_GG" } },
          { label: "ANARCHIA BOXPVP", value: "ANARCHIA_BOXPVP", emoji: { id: "1469444521308852324", name: "ANARCHIA_GG" } },
          { label: "PYK MC", value: "PYK_MC", emoji: { id: "1457113144412475635", name: "PYK_MC" } }
        );

      const metodaSelect = new StringSelectMenuBuilder()
        .setCustomId("kalkulator_metoda")
        .setPlaceholder("Wybierz metodę płatności...")
        .addOptions(
          { label: "BLIK", value: "BLIK", description: "Szybki przelew BLIK (0% prowizji)", emoji: { id: "1469107179234525184", name: "BLIK" } },
          { label: "Kod BLIK", value: "Kod BLIK", description: "Kod BLIK (10% prowizji)", emoji: { id: "1469107179234525184", name: "BLIK" } },
          { label: "PSC", value: "PSC", description: "Paysafecard (10% prowizji)", emoji: { id: "1469107238676467940", name: "PSC" } },
          { label: "PSC bez paragonu", value: "PSC bez paragonu", description: "Paysafecard bez paragonu (20% prowizji)", emoji: { id: "1469107238676467940", name: "PSC" } },
          { label: "MYPSC", value: "MYPSC", description: "MYPSC (20% lub min 10zł)", emoji: { id: "1469107199350669473", name: "MYPSC" } },
          { label: "PayPal", value: "PayPal", description: "PayPal (5% prowizji)", emoji: { id: "1449354427755659444", name: "PAYPAL" } },
          { label: "LTC", value: "LTC", description: "Litecoin (5% prowizji)", emoji: { id: "1449186363101548677", name: "LTC" } }
        );

      const embed = new EmbedBuilder()
        .setColor(COLOR_BLUE)
        .setDescription(
          "```\n" +
          "🔢 New Shop × Obliczanie\n" +
          "```\n" +
          `> 💵 × **Wybrana waluta:** \`${formatShortWaluta(waluta)}\`\n> ❗ × **Wybierz serwer i metodę płatności __poniżej:__`);

      await interaction.reply({
        embeds: [embed],
        components: [
          new ActionRowBuilder().addComponents(trybSelect),
          new ActionRowBuilder().addComponents(metodaSelect)
        ],
        flags: [MessageFlags.Ephemeral]
      });
    } catch (error) {
      console.error("Błąd w modal_ile_musze_dac:", error);
      await interaction.reply({
        content: "> `❌` × **Wystąpił** błąd podczas przetwarzania. Spróbuj **ponownie**.",
        flags: [MessageFlags.Ephemeral]
      });
    }
    return;
  }

  // NEW: konkurs create modal
  if (interaction.customId === "konkurs_create_modal") {
    await handleKonkursCreateModal(interaction);
    return;
  }

  // redeem code modal handling (used in tickets)
  if (interaction.customId.startsWith("modal_redeem_code_")) {
    const enteredCode = interaction.fields
      .getTextInputValue("discount_code")
      .toUpperCase();
    const codeData = activeCodes.get(enteredCode);

    if (!codeData) {
      await interaction.reply({
        content:
          "❌ **Nieprawidłowy kod!**",
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    // Sprawdź typ kodu
    if (codeData.type === "invite_cash" || codeData.type === "invite_reward") {
      await interaction.reply({
        content:
          "❌ Kod na 50k$ można wpisać jedynie klikając kategorię 'Nagroda za zaproszenia' w TicketPanel i wpisując tam kod!",
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    if (codeData.used) {
      await interaction.reply({
        content: "> `❌` × **Kod** został już wykorzystany!",
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    if (Date.now() > codeData.expiresAt) {
      activeCodes.delete(enteredCode);
      await db.deleteActiveCode(enteredCode);
      scheduleSavePersistentState();
      await interaction.reply({
        content: "> `❌` × **Kod** wygasł!",
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    codeData.used = true;
    activeCodes.delete(enteredCode);
    await db.deleteActiveCode(enteredCode);
    
    // Aktualizuj w Supabase
    await db.updateActiveCode(enteredCode, { used: true });
    
    scheduleSavePersistentState();

    const redeemEmbed = new EmbedBuilder()
      .setColor(0xd4af37)
      .setTitle("`📉` WYKORZYSTAŁEŚ KOD RABATOWY")
      .setDescription(
        "```\n" +
        enteredCode +
        "\n```\n" +
        `> 💸 × **Otrzymałeś:** \`-${codeData.discount}%\`\n`,
      )
      .setTimestamp();

    await interaction.reply({ embeds: [redeemEmbed] });
    console.log(
      `Użytkownik ${interaction.user.username} odebrał kod rabatowy ${enteredCode} (-${codeData.discount}%)`,
    );
    return;
  }

  // Ticket settings modals: rename/add/remove
  if (interaction.customId.startsWith("modal_rename_")) {
    const chId = interaction.customId.replace("modal_rename_", "");
    const newName = interaction.fields
      .getTextInputValue("new_ticket_name")
      .trim();
    const channel = await interaction.guild.channels
      .fetch(chId)
      .catch(() => null);
    if (!channel) {
      await interaction.reply({
        content: "> `❌` × **Kanał** nie znaleziony.",
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }
    const data = ticketOwners.get(chId) || { claimedBy: null };
    const claimer = data.claimedBy;

    if (!isAdminOrSeller(interaction.member)) {
      await interaction.reply({
        content: "> `❗` × Brak wymaganych uprawnień.",
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }
    if (
      claimer &&
      claimer !== interaction.user.id &&
      !isAdminOrSeller(interaction.member)
    ) {
      await interaction.reply({
        content: "> `❗` × Brak wymaganych uprawnień.",
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }
    try {
      await channel.setName(newName);
      await interaction.reply({
        content: `✅ Nazwa ticketu zmieniona na: ${newName}`,
        flags: [MessageFlags.Ephemeral],
      });
    } catch (err) {
      console.error("Błąd zmiany nazwy ticketu:", err);
      await interaction.reply({
        content: "> `❌` × **Nie udało się** zmienić nazwy (sprawdź uprawnienia).",
        flags: [MessageFlags.Ephemeral],
      });
    }
    return;
  }

  if (interaction.customId.startsWith("modal_add_")) {
    const chId = interaction.customId.replace("modal_add_", "");
    const userInput = interaction.fields
      .getTextInputValue("user_to_add")
      .trim();
    const channel = await interaction.guild.channels
      .fetch(chId)
      .catch(() => null);
    if (!channel) {
      await interaction.reply({
        content: "> `❌` × **Kanał** nie znaleziony.",
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }
    const data = ticketOwners.get(chId) || { claimedBy: null };
    const claimer = data.claimedBy;

    if (
      claimer &&
      claimer !== interaction.user.id &&
      !isAdminOrSeller(interaction.member)
    ) {
      await interaction.reply({
        content: "> `❗` × Brak wymaganych uprawnień.",
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    const match = userInput.match(/^<@!?(\d+)>$/);
    if (!match) {
      await interaction.reply({
        content: "> `❌` × **Nieprawidłowy** format użytkownika. Użyj **@mention**.",
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }
    const userIdToAdd = match[1];
    try {
      await channel.permissionOverwrites.edit(userIdToAdd, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true,
      });
      await interaction.reply({
        content: `✅ Dodano <@${userIdToAdd}> do ticketu.`,
        flags: [MessageFlags.Ephemeral],
      });
    } catch (err) {
      console.error("Błąd dodawania użytkownika do ticketu:", err);
      await interaction.reply({
        content: "> `❌` × **Nie udało się** dodać użytkownika (sprawdź uprawnienia).",
        flags: [MessageFlags.Ephemeral],
      });
    }
    return;
  }

  if (interaction.customId.startsWith("modal_remove_")) {
    const chId = interaction.customId.replace("modal_remove_", "");
    const userInput = interaction.fields
      .getTextInputValue("user_to_remove")
      .trim();
    const channel = await interaction.guild.channels
      .fetch(chId)
      .catch(() => null);
    if (!channel) {
      await interaction.reply({
        content: "> `❌` × **Kanał** nie znaleziony.",
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }
    const data = ticketOwners.get(chId) || { claimedBy: null };
    const claimer = data.claimedBy;

    if (!isAdminOrSeller(interaction.member)) {
      await interaction.reply({
        content: "> `❗` × Brak wymaganych uprawnień.",
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }
    if (
      claimer &&
      claimer !== interaction.user.id &&
      !isAdminOrSeller(interaction.member)
    ) {
      await interaction.reply({
        content: "> `❗` × Brak wymaganych uprawnień.",
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    const match = userInput.match(/^<@!?(\d+)>$/);
    if (!match) {
      await interaction.reply({
        content: "> `❌` × **Nieprawidłowy** format użytkownika. Użyj **@mention**.",
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }
    const userIdToRemove = match[1];
    try {
      await channel.permissionOverwrites.edit(userIdToRemove, {
        ViewChannel: false,
        SendMessages: false,
        ReadMessageHistory: false,
      });
      await interaction.reply({
        content: `✅ Usunięto <@${userIdToRemove}> z ticketu.`,
        flags: [MessageFlags.Ephemeral],
      });
    } catch (err) {
      console.error("Błąd usuwania użytkownika z ticketu:", err);
      await interaction.reply({
        content: "> `❌` × **Nie udało się** usunąć użytkownika (sprawdź uprawnienia).",
        flags: [MessageFlags.Ephemeral],
      });
    }
    return;
  }

  // Ticket creation modals
  let categoryId = null;
  let ticketType = null;
  let ticketTypeLabel = null;
  let formInfo = "";

  const guild = interaction.guild;
  const user = interaction.user;
  const categories = ticketCategories.get(guild.id) || {};

  switch (interaction.customId) {
    case "modal_odbior": {
      const enteredCodeRaw =
        interaction.fields.getTextInputValue("reward_code") || "";
      const enteredCode = enteredCodeRaw.trim().toUpperCase();

      if (!enteredCode) {
        await interaction.reply({
          content: "> `❌` × **Musisz** wpisać kod!",
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }

      const codeData = activeCodes.get(enteredCode);

      if (!codeData) {
        await interaction.reply({
          content: "> `❌` × **Nieprawidłowy** kod!",
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }

      if (codeData.used) {
        await interaction.reply({
          content: "> `❌` × **Kod** został już wykorzystany!",
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }

      if (Date.now() > codeData.expiresAt) {
        activeCodes.delete(enteredCode);
        scheduleSavePersistentState();
        await interaction.reply({
          content: "> `❌` × **Kod** wygasł!",
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }

      // Mark code as used
      codeData.used = true;
      activeCodes.delete(enteredCode);
      await db.deleteActiveCode(enteredCode);
      scheduleSavePersistentState();

      categoryId = REWARDS_CATEGORY_ID;
      ticketType = "odbior-nagrody";
      ticketTypeLabel = "NAGRODA ZA ZAPROSZENIA";
      formInfo = `> <a:arrowwhite:1469100658606211233> × **Kod:** \`${enteredCode}\`\n> <a:arrowwhite:1469100658606211233> × **Nagroda:** \`${codeData.reward || "Brak"}\``;
      break;
    }
    case "modal_konkurs_odbior": {
      const info = interaction.fields.getTextInputValue("konkurs_info");

      categoryId = REWARDS_CATEGORY_ID;
      ticketType = "konkurs-nagrody";
      ticketTypeLabel = "NAGRODA ZA KONKURS";
      formInfo = `> <a:arrowwhite:1469100658606211233> × **Informacje:** \`${info}\``;
      break;
    }
    case "modal_inne": {
      const sprawa = interaction.fields.getTextInputValue("sprawa");

      categoryId = categories["inne"];
      ticketType = "inne";
      ticketTypeLabel = "INNE";
      formInfo = `> <a:arrowwhite:1469100658606211233> × **Sprawa:** \`${sprawa}\``;
      break;
    }
    default:
      break;
  }

  // If ticketType not set it was probably a settings modal handled above or unknown
  if (!ticketType) return;

  try {
    // ENFORCE: One ticket per user
    // Search ticketOwners for existing open ticket owned by this user
    for (const [channelId, ticketData] of ticketOwners.entries()) {
      if (ticketData.userId === user.id) {
        await interaction.reply({
          content: `❌ Masz już otwarty ticket: <#${channelId}>`,
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }
    }

    const parentToUse = categoryId || categories["zakup-0-20"];

    const createOptions = {
      name: `ticket-${getNextTicketNumber(guild.id)}`,
      type: ChannelType.GuildText,
      parent: parentToUse,
      permissionOverwrites: [
        {
          id: interaction.guild.id,
          deny: [PermissionsBitField.Flags.ViewChannel], // @everyone nie widzi ticketów
        },
        {
          id: interaction.user.id,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory,
          ],
        },
      ],
    };

    // Dodaj rangi limitów w zależności od kategorii
    if (parentToUse) {
      const categoryId = parentToUse;
      
      // Specjalna obsługa dla kategorii "inne" - tylko właściciel i właściciel ticketu widzą
      if (categoryId === categories["inne"]) {
        createOptions.permissionOverwrites.push(
          { id: interaction.guild.ownerId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] } // właściciel serwera
        );
      }
      // Zakup 0-20 - wszystkie rangi widzą
      else if (categoryId === "1449526840942268526") {
        createOptions.permissionOverwrites.push(
          { id: "1449448705563557918", allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }, // limit 20
          { id: "1449448702925209651", allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }, // limit 50
          { id: "1449448686156255333", allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }, // limit 100
          { id: "1449448860517798061", allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }  // limit 200
        );
      }
      // Zakup 20-50 - limit 20 nie widzi
      else if (categoryId === "1449526958508474409") {
        createOptions.permissionOverwrites.push(
          { id: "1449448702925209651", allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }, // limit 50
          { id: "1449448686156255333", allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }, // limit 100
          { id: "1449448860517798061", allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }  // limit 200
        );
      }
      // Zakup 50-100 - limit 20 i 50 nie widzą
      else if (categoryId === "1449451716129984595") {
        createOptions.permissionOverwrites.push(
          { id: "1449448686156255333", allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }, // limit 100
          { id: "1449448860517798061", allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }  // limit 200
        );
      }
      // Zakup 100-200 - tylko limit 200 widzi
      else if (categoryId === "1449452354201190485") {
        createOptions.permissionOverwrites.push(
          { id: "1449448860517798061", allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }  // limit 200
        );
      }
    }

    const channel = await interaction.guild.channels.create(createOptions);

    const embed = new EmbedBuilder()
      .setColor(COLOR_BLUE) // Discord blurple (#5865F2)
      .setDescription(
        `## \`🛒 NEW SHOP × ${ticketTypeLabel}\`\n\n` +
        `### ・ 👤 × Informacje o kliencie:\n` +
        `> <a:arrowwhite:1469100658606211233> × **Ping:** <@${user.id}>\n` +
        `> <a:arrowwhite:1469100658606211233> × **Nick:** \`${interaction.member?.displayName || user.globalName || user.username}\`\n` +
        `> <a:arrowwhite:1469100658606211233> × **ID:** \`${user.id}\`\n` +
        `### ・ 📋 × Informacje z formularza:\n` +
        `${formInfo}`,
      )
      .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 128 }))
      .setTimestamp();

    const closeButton = new ButtonBuilder()
      .setCustomId(`ticket_close_${channel.id}`)
      .setLabel("Zamknij")
      .setStyle(ButtonStyle.Secondary);
    const settingsButton = new ButtonBuilder()
      .setCustomId(`ticket_settings_${channel.id}`)
      .setLabel("Ustawienia")
      .setStyle(ButtonStyle.Secondary);
    const claimButton = new ButtonBuilder()
      .setCustomId(`ticket_claim_${channel.id}`)
      .setLabel("Przejmij")
      .setStyle(ticketTypeLabel && ticketTypeLabel === "NAGRODA ZA ZAPROSZENIA" ? ButtonStyle.Secondary : ButtonStyle.Primary);
    const unclaimButton = new ButtonBuilder()
      .setCustomId(`ticket_unclaim_${channel.id}`)
      .setLabel("Odprzejmij")
      .setStyle(ticketTypeLabel && ticketTypeLabel === "NAGRODA ZA ZAPROSZENIA" ? ButtonStyle.Secondary : ButtonStyle.Danger)
      .setDisabled(true);

    const buttonRow = new ActionRowBuilder().addComponents(
      closeButton,
      settingsButton,
      claimButton,
      unclaimButton,
    );

    const sentMsg = await channel.send({
      content: `@everyone`,
      embeds: [embed],
      components: [buttonRow],
    });

    ticketOwners.set(channel.id, {
      claimedBy: null,
      userId: user.id,
      ticketMessageId: sentMsg.id,
      locked: false,
    });
    scheduleSavePersistentState();

    await logTicketCreation(interaction.guild, channel, {
      openerId: user.id,
      ticketTypeLabel,
      formInfo,
      ticketChannelId: channel.id,
      ticketMessageId: sentMsg.id,
    }).catch(() => { });

    await interaction.reply({
      content: `> ✅ **Utworzono ticket! Przejdź do:** <#${channel.id}>.`,
      flags: [MessageFlags.Ephemeral],
    });
  } catch (err) {
    console.error("Błąd tworzenia ticketu (odbior):", err);
    await interaction.reply({
      content: "> `❌` × **Wystąpił** błąd podczas tworzenia **ticketa**.",
      flags: [MessageFlags.Ephemeral],
    });
  }
}

async function handleKalkulatorSelect(interaction) {
  try {
    // Defer the interaction to avoid timeout
    await interaction.deferUpdate();

    const userId = interaction.user.id;
    const customId = interaction.customId;
    const selectedValue = interaction.values[0];

    // Pobierz aktualne dane użytkownika
    const userData = kalkulatorData.get(userId) || {};

    // Zaktualizuj odpowiednie pole
    if (customId === "kalkulator_tryb") {
      userData.tryb = selectedValue;
    } else if (customId === "kalkulator_metoda") {
      userData.metoda = selectedValue;
    }

    // Zapisz dane
    kalkulatorData.set(userId, userData);

    // Jeśli oba pola są wypełnione, oblicz i pokaż wynik
    if (userData.tryb && userData.metoda) {
      await handleKalkulatorSubmit(interaction, userData.typ);
    }
  } catch (error) {
    console.error("Błąd w handleKalkulatorSelect:", error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: "> `❌` × **Wystąpił** błąd podczas przetwarzania wyboru. Spróbuj **ponownie**.",
        flags: [MessageFlags.Ephemeral]
      });
    } else {
      await interaction.followUp({
        content: "> `❌` × **Wystąpił** błąd podczas przetwarzania wyboru. Spróbuj **ponownie**.",
        flags: [MessageFlags.Ephemeral]
      });
    }
  }
}

async function handleKalkulatorSubmit(interaction, typ) {
  try {
    const userId = interaction.user.id;
    const userData = kalkulatorData.get(userId) || {};

    if (!userData.tryb || !userData.metoda) {
      await interaction.followUp({
        content: "> `❌` × **Proszę** wybrać zarówno tryb jak i metodę **płatności**.",
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    const feePercent = getPaymentFeePercent(userData.metoda);
    const minPurchase = getMinPurchasePln(userData.metoda);

    if (typ === "otrzymam") {
      const kwota = userData.kwota;
      if (kwota < minPurchase) {
        await interaction.editReply({
          content: `> \`❌\` × **Minimalne zakupy** dla ${userData.metoda} to **${minPurchase}zł**.`,
          embeds: [],
          components: []
        });
        return;
      }
      const { fee, feeLabel } = calculateFeePln(kwota, userData.metoda);
      const effectivePln = kwota - fee;
      const rate = getRateForPlnAmount(kwota, userData.tryb);
      const waluta = Math.floor(effectivePln * rate);
      const kwotaZl = Math.trunc(Number(kwota) || 0);
      const walutaShort = formatShortWaluta(waluta);

      const msg = `> \`🔢\` × **Płacąc nam ${kwotaZl}zł (${userData.metoda} prowizja: ${feeLabel}) otrzymasz:** \`${walutaShort}\` **(${waluta} $)**`;

      await interaction.editReply({
        content: msg,
        embeds: [],
        components: []
      });
    } else {
      const waluta = userData.waluta;
      const server = (userData.tryb || "").toString().toUpperCase();
      let rate;
      if (server === "ANARCHIA_BOXPVP") {
        rate = 650000;
      } else if (server === "ANARCHIA_LIFESTEAL") {
        const estimatedPln4500 = waluta / 4500;
        rate = estimatedPln4500 >= 100 ? 5000 : 4500;
      } else {
        // PYK MC
        const estimatedPln3500 = waluta / 3500;
        rate = estimatedPln3500 >= 100 ? 4000 : 3500;
      }
      const baseRaw = waluta / rate;
      const basePln = round2(baseRaw);
      const { fee, feeLabel } = calculateFeePln(basePln, userData.metoda);
      const totalPln = round2(basePln + fee);

      const totalZl = Math.trunc(Number(totalPln) || 0);
      if (totalZl < minPurchase) {
        await interaction.editReply({
          content: `> \`❌\` × **Minimalne zakupy** dla ${userData.metoda} to **${minPurchase}zł**.`,
          embeds: [],
          components: []
        });
        return;
      }
      const walutaInt = Math.floor(Number(waluta) || 0);
      const walutaShort = formatShortWaluta(walutaInt);

      const msg = `> \`🔢\` × **Aby otrzymać:** \`${walutaShort}\` **(${walutaInt} $)** **musisz zapłacić ${totalZl}zł (${userData.metoda} prowizja: ${feeLabel})**`;

      await interaction.editReply({
        content: msg,
        embeds: [],
        components: []
      });
    }

    // Wyczyść dane użytkownika
    kalkulatorData.delete(userId);
  } catch (error) {
    console.error("Błąd w handleKalkulatorSubmit:", error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: "> `❌` × **Wystąpił** błąd podczas obliczania. Spróbuj **ponownie**.",
        flags: [MessageFlags.Ephemeral]
      });
    } else {
      await interaction.followUp({
        content: "> `❌` × **Wystąpił** błąd podczas obliczania. Spróbuj **ponownie**.",
        flags: [MessageFlags.Ephemeral]
      });
    }
  }
}

async function handleButtonInteraction(interaction) {
  const customId = interaction.customId;
  const botName = client.user?.username || "NEWSHOP";

  // KONKURSY: obsługa przycisków konkursowych
  if (customId.startsWith("konkurs_join_")) {
    const msgId = customId.replace("konkurs_join_", "");
    
    const modal = new ModalBuilder()
      .setCustomId(`konkurs_join_modal_${msgId}`)
      .setTitle("Dołącz do konkursu");

const nickInput = new TextInputBuilder()
  .setCustomId("konkurs_nick")
  .setLabel("Twój nick z Minecraft (opcjonalnie)")
  .setStyle(TextInputStyle.Short)
  .setRequired(false) // <- to sprawia, że pole jest opcjonalne
  .setMaxLength(20)
  .setPlaceholder("Przykład: KosiaraWTF");


    const row1 = new ActionRowBuilder().addComponents(nickInput);
    modal.addComponents(row1);

    await interaction.showModal(modal);
    return;
  }

  if (customId.startsWith("konkurs_leave_")) {
    const msgId = customId.replace("konkurs_leave_", "");
    await handleKonkursLeave(interaction, msgId);
    return;
  }

  if (customId.startsWith("konkurs_cancel_leave_")) {
    const msgId = customId.replace("konkurs_cancel_leave_", "");
    await handleKonkursCancelLeave(interaction, msgId);
    return;
  }

  if (customId.startsWith("confirm_leave_")) {
    const msgId = customId.replace("confirm_leave_", "");
    await handleKonkursLeave(interaction, msgId);
    return;
  }

  if (customId.startsWith("cancel_leave_")) {
    const cancelEmbed = new EmbedBuilder()
      .setColor(COLOR_BLUE)
      .setDescription("> `📋` × Anulowano");
    
    await interaction.update({
      embeds: [cancelEmbed],
      components: [],
    });
    return;
  }

  if (customId.startsWith("mody_videos_")) {
    try {
      await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
    } catch (err) {
      // Interaction token already expired or already acknowledged.
      console.warn("[mody] Nie udało się potwierdzić interakcji przycisku:", err?.code || err);
      return;
    }

    const resolvedVideos = [];
    const seenKeys = new Set();
    const seenUrls = new Set();

    const addResolvedVideo = (videoCfg, url, labelFallback = "Nagranie") => {
      if (!isHttpUrl(url)) return;
      const key = videoCfg?.key ? `key:${videoCfg.key}` : `url:${url}`;
      if (seenKeys.has(key) || seenUrls.has(url)) return;
      seenKeys.add(key);
      seenUrls.add(url);
      resolvedVideos.push({
        videoCfg: videoCfg || null,
        url,
        labelFallback,
      });
    };

    // 1) Najpierw bierzemy video z wiadomości panelu (to najszybsza ścieżka).
    const fromCurrentMessage = collectVideoLinksFromMessage(interaction.message);
    for (const item of fromCurrentMessage) {
      const cfgFromAttachment =
        (item?.key && MODS_VIDEO_FILES.find((v) => v.key === item.key)) ||
        getModsVideoConfigByFilename(item?.label || "");
      addResolvedVideo(
        cfgFromAttachment,
        item?.url || "",
        item?.modName || item?.label || "Nagranie",
      );
    }

    // 2) Następnie dokładamy szybkie źródła (env/cache/local-route) bez wolnego skanowania kanałów.
    for (const videoCfg of MODS_VIDEO_FILES) {
      const url = await resolveModsVideoUrl(interaction.guild, videoCfg, {
        allowSlowScan: false,
      });
      addResolvedVideo(videoCfg, url, videoCfg.modName || videoCfg.label || "Nagranie");
    }

    if (resolvedVideos.length > 0) {
      const MAX_VIDEO_MESSAGES = 10;
      resolvedVideos.sort((a, b) => {
        const rankA = getModsVideoOrderRank(a.videoCfg);
        const rankB = getModsVideoOrderRank(b.videoCfg);
        if (rankA !== rankB) return rankA - rankB;
        const keyA = a.videoCfg?.key || a.labelFallback || "";
        const keyB = b.videoCfg?.key || b.labelFallback || "";
        return keyA.localeCompare(keyB, "pl");
      });
      const videosToSend = resolvedVideos.slice(0, MAX_VIDEO_MESSAGES);

      if (!interaction.channel || typeof interaction.channel.send !== "function") {
        await interaction.editReply({
          content: "> `❌` × Nie mogę wysłać nagrań na tym kanale.",
        });
        return;
      }

      let sentCount = 0;
      for (const video of videosToSend) {
        const caption = getModsVideoCaption(video.videoCfg, video.labelFallback);
        try {
          await interaction.channel.send({
            content: `${caption}\n${video.url}`,
          });
          sentCount += 1;
        } catch (sendErr) {
          console.error("[mody] Nie udało się wysłać pojedynczego nagrania:", sendErr);
        }
      }

      if (sentCount === 0) {
        await interaction.editReply({
          content:
            "> `❌` × Nie udało się wysłać nagrań. Sprawdź uprawnienia i poprawność źródeł wideo.",
        });
        return;
      }

      const limitNote =
        resolvedVideos.length > MAX_VIDEO_MESSAGES
          ? `\n> \`⚠️\` × Pokazano **${MAX_VIDEO_MESSAGES}/${resolvedVideos.length}** nagrań (limit anty-spam).`
          : "";

      await interaction.editReply({
        content: `> \`✅\` × Wysłano **${sentCount}** nagrań na kanał.${limitNote}`,
      });
      return;
    }

    const localVideo =
      MODS_VIDEO_FILES
        .map((cfg) => ({
          cfg,
          localPath: resolveLocalModsVideoPath(cfg),
        }))
        .find((item) => !!item.localPath) || null;

    if (localVideo) {
      let videoSize = 0;
      try {
        videoSize = fs.statSync(localVideo.localPath).size || 0;
      } catch {
        videoSize = 0;
      }

      const sizeMb = (videoSize / 1024 / 1024).toFixed(1);
      const limitMb = (DISCORD_MAX_UPLOAD_BYTES / 1024 / 1024).toFixed(0);
      await interaction.editReply({
        content:
          `> \`❌\` × Nie mam publicznego linku do **${path.basename(localVideo.localPath)}**.\n` +
          `> \`ℹ️\` × Lokalny plik ma \`${sizeMb} MB\`, a limit uploadu Discord to ok. \`${limitMb} MB\`.\n` +
          `> \`✅\` × Ustaw URL w env \`${localVideo.cfg.envVar}\` (albo wrzuć film na kanał i kliknij przycisk ponownie).`,
      });
      return;
    }

    await interaction.editReply({
      content:
        "> `❌` × Nie znaleziono żadnych nagrań modów ani linków do nich.",
    });
    return;
  }

  if (customId.startsWith("mody_buy_")) {
    const modal = new ModalBuilder()
      .setCustomId("modal_mody_zakup")
      .setTitle("Zakup moda");

    const modNameInput = new TextInputBuilder()
      .setCustomId("mod_name")
      .setLabel("Jakiego moda chcesz kupić?")
      .setPlaceholder("Przykład: Auto_Dripstone")
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(64);

    const paymentMethodInput = new TextInputBuilder()
      .setCustomId("payment_method")
      .setLabel("Jaką metodą płatności płacisz?")
      .setPlaceholder("Przykład: Blik")
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(64);

    const modsCountInput = new TextInputBuilder()
      .setCustomId("mods_count")
      .setLabel("Ile modów chcesz kupić? (1-4)")
      .setPlaceholder("Przykład: 1")
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(1);

    modal.addComponents(
      new ActionRowBuilder().addComponents(modNameInput),
      new ActionRowBuilder().addComponents(paymentMethodInput),
      new ActionRowBuilder().addComponents(modsCountInput),
    );

    await interaction.showModal(modal);
    return;
  }

  // NEW: verification panel button
  if (customId.startsWith("verify_panel_")) {
    // very simple puzzles for preschool level: addition and multiplication with small numbers
    let expression;
    let answer;

    const operators = ["+", "*"];
    const op = operators[Math.floor(Math.random() * operators.length)];

    if (op === "+") {
      // addition: numbers 1-5
      const left = Math.floor(Math.random() * 5) + 1; // 1-5
      const right = Math.floor(Math.random() * 5) + 1; // 1-5
      expression = `${left} + ${right}`;
      answer = left + right;
    } else {
      // multiplication: small multiplier 1-3
      const left = Math.floor(Math.random() * 5) + 1; // 1-5
      const right = Math.floor(Math.random() * 3) + 1; // 1-3
      expression = `${left} * ${right}`;
      answer = left * right;
    }

    const modalId = `modal_verify_${interaction.guildId}_${interaction.user.id}_${Date.now()}`;

    // store answer for this modal
    const roleId = verificationRoles.get(interaction.guildId) || null;
    pendingVerifications.set(modalId, {
      answer,
      guildId: interaction.guildId,
      userId: interaction.user.id,
      roleId,
    });
    scheduleSavePersistentState();

    const modal = new ModalBuilder()
      .setCustomId(modalId)
      .setTitle("WERYFIKACJA");

    const answerInput = new TextInputBuilder()
      .setCustomId("verify_answer")
      .setLabel(`Ile to ${expression}?`)
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("Wpisz wynik")
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(answerInput));

    await interaction.showModal(modal);
    return;
  }

  // KALKULATOR: ile otrzymam?
  if (customId === "kalkulator_ile_otrzymam") {
    const modal = new ModalBuilder()
      .setCustomId("modal_ile_otrzymam")
      .setTitle("New Shop × Obliczanie");

    const kwotaInput = new TextInputBuilder()
      .setCustomId("kwota")
      .setLabel("Kwota (PLN)")
      .setPlaceholder("np. 50")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    modal.addComponents(
      new ActionRowBuilder().addComponents(kwotaInput)
    );

    await interaction.showModal(modal);
  }

  // KALKULATOR: ile muszę dać?
  if (customId === "kalkulator_ile_musze_dac") {
    const modal = new ModalBuilder()
      .setCustomId("modal_ile_musze_dac")
      .setTitle("New Shop × Obliczanie");

    const walutaInput = new TextInputBuilder()
      .setCustomId("waluta")
      .setLabel("Ilość waluty (np. 125k / 1m)")
      .setPlaceholder("np. 125k")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    modal.addComponents(
      new ActionRowBuilder().addComponents(walutaInput)
    );

    await interaction.showModal(modal);
  }

  // Ticket close - double confirmation logic BUT restricted to admins/sellers
  if (customId.startsWith("ticket_close_")) {
    const channel = interaction.channel;
    if (!isTicketChannel(channel)) {
      await interaction.reply({
        content: "> `❌` × Ta **komenda** działa jedynie na **ticketach**!",
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    if (!isAdminOrSeller(interaction.member)) {
      await interaction.reply({
        content: "> `❗` × Brak wymaganych uprawnień.",
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    const chId = channel.id;
    const now = Date.now();
    const pending = pendingTicketClose.get(chId);

    // If there's a pending close and it's by same user and not expired -> proceed
    if (
      pending &&
      pending.userId === interaction.user.id &&
      now - pending.ts < 30_000
    ) {
      pendingTicketClose.delete(chId);
      // remove ticketOwners entry immediately
      const ticketMeta = ticketOwners.get(chId) || null;
      ticketOwners.delete(chId);
      scheduleSavePersistentState();

      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLOR_BLUE)
            .setDescription("> \`ℹ️\` × **Ticket zostanie zamknięty w ciągu 5 sekund...**")
        ]
      });

      // Archive & log immediately, then delete channel shortly after
      try {
        await archiveTicketOnClose(
          channel,
          interaction.user.id,
          ticketMeta,
        ).catch((e) => console.error("archiveTicketOnClose error:", e));
      } catch (e) {
        console.error("Błąd archiwizacji ticketu (button):", e);
      }

      setTimeout(async () => {
        try {
          await channel.delete();
          console.log(`Zamknięto ticket ${channel.name}`);
        } catch (error) {
          console.error("Błąd zamykania ticketu:", error);
        }
      }, 2000);
    } else {
      // set pending note
      pendingTicketClose.set(chId, { userId: interaction.user.id, ts: now });
      await interaction.reply({
        content:
          "> \`⚠️\` **Kliknij ponownie przycisk zamknięcia w ciągu `30` sekund aby potwierdzić __zamknięcie ticketu!__**",
        flags: [MessageFlags.Ephemeral],
      });
      // schedule expiry
      setTimeout(() => pendingTicketClose.delete(chId), 30_000);
    }
    return;
  }

  // Redeem code (ticket modal)
  if (customId.startsWith("ticket_code_")) {
    const parts = customId.split("_");
    const ticketChannelId = parts[2];
    const ticketUserId = parts[3];

    if (interaction.user.id !== ticketUserId) {
      await interaction.reply({
        content: "> `❗` × Brak wymaganych uprawnień.",
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId(`modal_redeem_code_${interaction.channel.id}`)
      .setTitle("Wpisz kod rabatowy");

    const codeInput = new TextInputBuilder()
      .setCustomId("discount_code")
      .setLabel("Wpisz kod który wygrałeś w /drop")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("np. ABC123XYZ0")
      .setRequired(true)
      .setMinLength(10)
      .setMaxLength(10);

    modal.addComponents(new ActionRowBuilder().addComponents(codeInput));
    await interaction.showModal(modal);
    return;
  }

  // Ticket settings button - ONLY admin/seller can use
  if (customId.startsWith("ticket_settings_")) {
    const channel = interaction.channel;
    if (!isTicketChannel(channel)) {
      await interaction.reply({
        content: "> `❌` × **Ta funkcja** działa jedynie na **ticketach**!",
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    // Only administrator or seller can use settings
    if (!isAdminOrSeller(interaction.member)) {
      await interaction.reply({
        content: "> `❗` × Brak wymaganych uprawnień.",
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    // build embed (left stripe + header like screenshot)
    const settingsEmbed = new EmbedBuilder()
      .setColor(COLOR_BLUE)
      .setDescription("⚙️ × **Wybierz akcję z menu poniżej:**");

    // select menu with placeholder like the screenshot
    const select = new StringSelectMenuBuilder()
      .setCustomId(`ticket_settings_select_${channel.id}`)
      .setPlaceholder("❌ × Nie wybrano żadnej z akcji...")
      .addOptions([
        {
          label: "Dodaj osobę",
          value: "add",
          description: "Dodaj użytkownika do ticketu",
        },
        {
          label: "Zmień nazwę kanału",
          value: "rename",
          description: "Zmień nazwę tego ticketu",
        },
        {
          label: "Usuń osobę",
          value: "remove",
          description: "Usuń dostęp użytkownika z ticketu",
        },
      ]);

    const row = new ActionRowBuilder().addComponents(select);

    await interaction.reply({
      embeds: [settingsEmbed],
      components: [row],
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // Claiming a ticket via button - ONLY admin or seller
  // Ticket claim/unclaim -> wspólna logika (tak samo jak /przejmij i /odprzejmij)
  if (customId.startsWith("ticket_claim_")) {
    const channelId = customId.replace("ticket_claim_", "");
    await ticketClaimCommon(interaction, channelId);
    return;
  }
  if (customId.startsWith("ticket_unclaim_")) {
    const parts = customId.split("_");
    const channelId = parts[2];
    const expectedClaimer = parts[3] || null;
    await ticketUnclaimCommon(interaction, channelId, expectedClaimer, { reason: null });
    return;
  }
}

async function handleSlashCommand(interaction) {
  const { commandName } = interaction;

  switch (commandName) {
    default: {
      // Gate: zwykły użytkownik widzi/uruchomi tylko publiczne komendy
      const publicCommands = new Set(["drop", "opinia", "help", "sprawdz-zaproszenia"]);
      // Komendy wymagające własnych uprawnień, ale nie blokowane przez seller/admin gate
      const bypassGate = new Set(["utworz-konkurs", "wyczysckanal", "stworzkonkurs", "end-giveaways"]);
      const SELLER_ROLE_ID = "1350786945944391733";
      const isSeller = interaction.member?.roles?.cache?.has(SELLER_ROLE_ID);
      const isAdmin = interaction.member?.permissions?.has(PermissionFlagsBits.Administrator);
      if (!isAdmin && !isSeller && !publicCommands.has(commandName) && !bypassGate.has(commandName)) {
        await interaction.reply({
          content: "> `❌` × Nie masz uprawnień do tej komendy.",
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }
      break;
    }
    case "drop":
      await handleDropCommand(interaction);
      break;
    case "free-kasa":
      await handleFreeKasaCommand(interaction);
      break;
    case "panelkalkulator":
      await handlePanelKalkulatorCommand(interaction);
      break;
    case "help":
      await handleHelpCommand(interaction);
      break;
    case "opiniekanal":
      await handleOpinieKanalCommand(interaction);
      break;
    case "ticket":
      await handleTicketCommand(interaction);
      break;
    case "ticket-zakoncz":
      await handleTicketZakonczCommand(interaction);
      break;
    case "zamknij-z-powodem":
      await handleZamknijZPowodemCommand(interaction);
      break;
    case "legit-rep-ustaw":
      await handleLegitRepUstawCommand(interaction);
      break;
    case "ticketpanel":
      await handleTicketPanelCommand(interaction);
      break;
    case "zamknij":
      await handleCloseTicketCommand(interaction);
      break;
    case "panelweryfikacja":
      await handlePanelWeryfikacjaCommand(interaction);
      break;
    case "opinia":
      await handleOpinionCommand(interaction);
      break;
    case "wyczysc":
      await handleWyczyscKanalCommand(interaction);
      break;
    case "resetlc":
      await handleResetLCCommand(interaction);
      break;
    case "zco":
      await handleZresetujCzasCommand(interaction);
      break;
    case "przejmij":
      await handleAdminPrzejmij(interaction);
      break;
    case "odprzejmij":
      await handleAdminOdprzejmij(interaction);
      break;
    case "autoprzejmij":
      await handleAutoPrzejmijCommand(interaction);
      break;
    case "embed":
      await handleSendMessageCommand(interaction);
      break;
    case "mody":
      await handleModyCommand(interaction);
      break;
    case "sprawdz-zaproszenia":
      await handleSprawdzZaproszeniaCommand(interaction);
      break;
    case "sprawdz-kogo-zaprosil":
      await handleSprawdzKogoZaprosilCommand(interaction);
      break;
    case "utworz-konkurs":
      await handleDodajKonkursCommand(interaction);
      break;
    case "rozliczenie":
      await handleRozliczenieCommand(interaction);
      break;
    case "rozliczeniazaplacil":
      await handleRozliczenieZaplacilCommand(interaction);
      break;
    case "rozliczeniezakoncz":
      await handleRozliczenieZakonczCommand(interaction);
      break;
    case "statusbota":
      await handleStatusBotaCommand(interaction);
      break;
    case "rozliczenieustaw":
      await handleRozliczenieUstawCommand(interaction);
      break;
    case "wezwij":
      await handleWezwijCommand(interaction);
      break;
    case "zaproszeniastats":
      await handleZaprosieniaStatsCommand(interaction);
      break;
    case "stworzkonkurs":
      await handleDodajKonkursCommand(interaction);
      break;
    case "end-giveaways":
      await handleEndGiveawaysCommand(interaction);
      break;
  }
}

// Handler dla komendy /rozliczenie
async function handleRozliczenieCommand(interaction) {
  // Sprawdź czy właściciel lub ma odpowiednią rolę
  const isOwner = interaction.user.id === interaction.guild.ownerId;
  const requiredRoleId = "1350786945944391733";
  const hasRole = interaction.member.roles.cache.has(requiredRoleId);
  
  if (!isOwner && !hasRole) {
    await interaction.reply({
      content: "> `❗` × Brak wymaganych uprawnień.",
      flags: [MessageFlags.Ephemeral]
    });
    return;
  }

  // Sprawdź czy komenda jest używana na właściwym kanale
  if (interaction.channelId !== ROZLICZENIA_CHANNEL_ID) {
    await interaction.reply({
      content: `❌ Ta komenda może być użyta tylko na kanale rozliczeń! <#${ROZLICZENIA_CHANNEL_ID}>`,
      flags: [MessageFlags.Ephemeral]
    });
    return;
  }

  const kwota = interaction.options.getInteger("kwota");
  const userId = interaction.user.id;

  if (!weeklySales.has(userId)) {
    weeklySales.set(userId, { amount: 0, lastUpdate: Date.now() });
  }

  const userData = weeklySales.get(userId);
  userData.amount += kwota;
  userData.lastUpdate = Date.now();
  
  // Zapisz weekly sales do Supabase
  await db.saveWeeklySale(userId, userData.amount, interaction.guild.id, userData.paid || false, userData.paidAt || null);
  console.log(`[rozliczenie] Użytkownik ${userId} dodał rozliczenie: ${kwota} zł, suma tygodniowa: ${userData.amount} zł`);

  const embed = new EmbedBuilder()
    .setColor(COLOR_BLUE)
    .setTitle("\`💱\` Rozliczenie dodane")
    .setDescription(
      `> 👤 **Użytkownik:** <@${userId}>\n` +
      `> \`✅\` × **Dodano sprzedaż:** ${kwota.toLocaleString("pl-PL")} zł\n` +
      `> \`📊\` × **Suma tygodniowa:** ${userData.amount.toLocaleString("pl-PL")} zł\n` +
      `> \`💸\` × **Prowizja do zapłaty (10%):** ${(userData.amount * ROZLICZENIA_PROWIZJA).toLocaleString("pl-PL")} zł\n`,
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
  console.log(`Użytkownik ${userId} dodał rozliczenie: ${kwota} zł`);
  
  // Odśwież wiadomość ROZLICZENIA TYGODNIOWE po dodaniu rozliczenia
  setTimeout(sendRozliczeniaMessage, 1000);
}

// Handler dla komendy /rozliczeniazaplacil
async function handleRozliczenieZaplacilCommand(interaction) {
  // Sprawdź czy właściciel
  if (interaction.user.id !== interaction.guild.ownerId) {
    await interaction.reply({
      content: "> `❗` × Brak wymaganych uprawnień.",
      flags: [MessageFlags.Ephemeral]
    });
    return;
  }

  const targetUser = interaction.options.getUser("uzytkownik");
  const userId = targetUser.id;

  // Sprawdź czy użytkownik ma rozliczenie
  if (!weeklySales.has(userId)) {
    await interaction.reply({
      content: `❌ Użytkownik <@${userId}> nie ma żadnych rozliczeń!`,
      flags: [MessageFlags.Ephemeral]
    });
    return;
  }

  const userData = weeklySales.get(userId);
  const prowizja = userData.amount * ROZLICZENIA_PROWIZJA;

  // Zaktualizuj status zapłaty
  userData.paid = true;
  userData.paidAt = Date.now();
  weeklySales.set(userId, userData);

  // Zapisz do Supabase
  await db.saveWeeklySale(userId, userData.amount, interaction.guild.id, true, Date.now());

  const embed = new EmbedBuilder()
    .setColor(0x00ff00) // zielony
    .setTitle("✅ Rozliczenie oznaczone jako zapłacone")
    .setDescription(
      `> \`✅\` × <@${userId}> **Zapłacił** **${prowizja.toLocaleString("pl-PL")} zł**\n` +
      `> \`📊\` × **Suma sprzedaży:** ${userData.amount.toLocaleString("pl-PL")} zł\n` +
      `> \`🕐\` × **Czas zapłaty:** <t:${Math.floor(Date.now() / 1000)}:R>`
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
  console.log(`[rozliczenie] Admin ${interaction.user.id} oznaczył rozliczenie użytkownika ${userId} jako zapłacone (${prowizja} zł)`);
  
  // Odśwież wiadomość ROZLICZENIA TYGODNIOWE
  setTimeout(sendRozliczeniaMessage, 1000);
}

// Handler dla komendy /rozliczeniezakoncz
async function handleRozliczenieZakonczCommand(interaction) {
  // Sprawdź czy właściciel
  if (interaction.user.id !== interaction.guild.ownerId) {
    await interaction.reply({
      content: "> `❗` × Brak wymaganych uprawnień.",
      flags: [MessageFlags.Ephemeral]
    });
    return;
  }

  try {
    const logsChannel = await client.channels.fetch(ROZLICZENIA_LOGS_CHANNEL_ID);
    if (!logsChannel) {
      await interaction.reply({
        content: "> `❌` × **Nie znaleziono** kanału **rozliczeń**!",
        flags: [MessageFlags.Ephemeral]
      });
      return;
    }

    if (weeklySales.size === 0) {
      await interaction.reply({
        content: "> `❌` × **Brak** rozliczeń w tym **tygodniu**!",
        flags: [MessageFlags.Ephemeral]
      });
      return;
    }

    // Zbuduj raport jako embed
    let totalSales = 0;
    let reportLines = [];

    for (const [userId, data] of weeklySales) {
      const prowizja = data.amount * ROZLICZENIA_PROWIZJA;
      // Pobierz nazwę użytkownika zamiast pingować
      const user = client.users.cache.get(userId);
      const userName = user ? `<@${userId}>` : `<@${userId}>`;
      
      reportLines.push(`${userName} Do zapłaty ${prowizja.toFixed(2)}zł`);
      totalSales += data.amount;
    }

    const totalProwizja = (totalSales * ROZLICZENIA_PROWIZJA).toFixed(2);

    const reportEmbed = new EmbedBuilder()
      .setColor(COLOR_BLUE)
      .setTitle("\`📊\` ROZLICZENIA TYGODNIOWE")
      .setDescription(
        reportLines.join('\n') + '\n\n' +
        `> \`📱\` **Przelew na numer:** 880 260 392\n` +
        `> \`⏳\` **Termin płatności:** do 20:00 dnia dzisiejszego\n` +
        `> \`🚫\` **Od teraz do czasu zapłaty nie macie dostępu do ticketów**`
      )
      .setTimestamp()
      .setFooter({ text: "Raport tygodniowy" });

    const sentMessage = await logsChannel.send({ embeds: [reportEmbed] });

    // Wyślij osobną wiadomość z pingami osób do zapłaty
    if (weeklySales.size > 0) {
      const pings = [];
      for (const [userId, data] of weeklySales) {
        pings.push(`<@${userId}>`);
      }
      
      const pingMessage = await logsChannel.send({
        content: `**Osoby do zapłaty prowizji:** ${pings.join(' ')}`
      });
      
      // Usuń wiadomość z pingami po 5 sekundach
      setTimeout(() => {
        pingMessage.delete().catch(err => console.log('Nie udało się usunąć wiadomości z pingami:', err));
      }, 5000);
    }

    // Zapisz dane przed resetem dla embeda
    const liczbaOsob = weeklySales.size;
    const totalSalesValue = totalSales;
    const totalProwizjaValue = totalProwizja;

    // Resetuj dane po wysłaniu raportu - TYLKO rozliczenia, NIE zaproszenia!
    weeklySales.clear();
    console.log("Ręcznie zresetowano rozliczenia po /rozliczeniezakoncz");
    
    // Resetuj też w Supabase - usuń WSZYSTKIE rozliczenia
    try {
      const { error } = await supabase
        .from("weekly_sales")
        .delete()
        .neq("user_id", "000000000000000000"); // usuń wszystkie (warunek zawsze prawdziwy)
        
      if (error) {
        console.error("[Supabase] Błąd resetowania wszystkich weekly_sales:", error);
      } else {
        console.log("[Supabase] Zresetowano WSZYSTKIE weekly_sales w bazie danych");
      }
    } catch (err) {
      console.error("Błąd podczas resetowania wszystkich rozliczeń w Supabase:", err);
    }
    
    // UWAGA: NIE resetujemy zaproszeń - są one przechowywane w Supabase osobno!
    console.log("🔒 ZAPROSZENIA ZACHOWANE - nie resetowane!");

    const embed = new EmbedBuilder()
      .setColor(COLOR_BLUE)
      .setTitle("✅ Podsumowanie wysłane i zresetowano")
      .setDescription(
        `> \`✅\` × **Wysłano podsumowanie** na kanał <#${ROZLICZENIA_LOGS_CHANNEL_ID}>\n` +
        `> \`🔄\` × **Zresetowano statystyki** na nowy tydzień\n` +
        `> \`📊\` × **Liczba osób:** ${liczbaOsob}\n` +
        `> \`💰\` × **Łączna sprzedaż:** ${totalSalesValue.toLocaleString("pl-PL")} zł\n` +
        `> \`💸\` × **Łączna prowizja:** ${parseFloat(totalProwizjaValue).toFixed(2)} zł`
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
    console.log(`Właściciel ${interaction.user.id} wygenerował podsumowanie rozliczeń`);
  } catch (err) {
    console.error("Błąd generowania podsumowania:", err);
    await interaction.reply({
      content: "> `❌` × **Wystąpił** błąd podczas generowania **podsumowania**!",
      flags: [MessageFlags.Ephemeral]
    });
  }
}

// Handler dla komendy /statusbota
async function handleStatusBotaCommand(interaction) {
  // Sprawdź czy właściciel
  if (interaction.user.id !== interaction.guild.ownerId) {
    await interaction.reply({
      content: "> `❗` × Brak wymaganych uprawnień.",
      flags: [MessageFlags.Ephemeral]
    });
    return;
  }

  try {
    const status = await checkBotStatus();
    
    const embed = new EmbedBuilder()
      .setColor(status.statusColor)
      .setTitle("📊 Status Bota")
      .setDescription(`**Status:** ${status.status}`)
      .addFields(
        { name: "⏱ Uptime", value: status.uptime, inline: true },
        { name: "📡 Ping", value: `${status.ping}ms (avg: ${status.avgPing}ms)`, inline: true },
        { name: "🔢 Błędy", value: status.errorCount.toString(), inline: true },
        { name: "🌐 Serwery", value: status.guilds.toString(), inline: true },
        { name: "👥 Użytkownicy", value: status.users.toString(), inline: true },
        { name: "💬 Kanały", value: status.channels.toString(), inline: true }
      )
      .setTimestamp()
      .setFooter({ text: "Bot Monitoring System" });

    await interaction.reply({ embeds: [embed] });
  } catch (err) {
    console.error("Błąd komendy /statusbota:", err);
    await interaction.reply({
      content: "> `❌` × **Wystąpił** błąd podczas pobierania statusu **bota**!",
      flags: [MessageFlags.Ephemeral]
    });
  }
}

// Handler dla komendy /rozliczenieustaw
async function handleRozliczenieUstawCommand(interaction) {
  // Sprawdź czy właściciel
  if (interaction.user.id !== interaction.guild.ownerId) {
    await interaction.reply({
      content: "> `❗` × Brak wymaganych uprawnień.",
      flags: [MessageFlags.Ephemeral]
    });
    return;
  }

  const targetUser = interaction.options.getUser("uzytkownik");
  const akcja = interaction.options.getString("akcja");
  const kwota = interaction.options.getInteger("kwota");
  const userId = targetUser.id;

  // Inicjalizuj użytkownika jeśli nie istnieje
  if (!weeklySales.has(userId)) {
    weeklySales.set(userId, { amount: 0, lastUpdate: Date.now() });
  }

  const userData = weeklySales.get(userId);

  if (akcja === "dodaj") {
    userData.amount += kwota;
  } else if (akcja === "odejmij") {
    userData.amount = Math.max(0, userData.amount - kwota);
  } else if (akcja === "ustaw") {
    userData.amount = kwota;
  }

  userData.lastUpdate = Date.now();
  
  // Zapisz do Supabase
  await db.saveWeeklySale(userId, userData.amount, interaction.guild.id);
  
  // Zapisz stan po zmianie rozliczenia
  scheduleSavePersistentState();

  const prowizja = userData.amount * ROZLICZENIA_PROWIZJA;
  const zmiana = kwota;
  const znakZmiany = akcja === "dodaj" ? "+" : akcja === "odejmij" ? "-" : "";

  const embed = new EmbedBuilder()
    .setColor(0x00ff00)
    .setTitle("✅ Rozliczenie zaktualizowane")
    .setDescription(
      `> \`✅\` × **Zaktualizowano rozliczenie** dla <@${userId}>\n` +
      `> 👤 **Użytkownik:** ${targetUser.username}\n` +
      `> 🔄 **Akcja:** ${akcja.charAt(0).toUpperCase() + akcja.slice(1)}\n` +
      `> 💰 **Kwota zmiany:** ${znakZmiany}${zmiana.toLocaleString("pl-PL")} zł\n` +
      `> 📈 **Nowa suma:** ${userData.amount.toLocaleString("pl-PL")} zł\n` +
      `> 💸 **Prowizja do zapłaty:** ${prowizja.toLocaleString("pl-PL")} zł`
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
  console.log(`Właściciel zaktualizował rozliczenie dla ${userId}: ${akcja} ${kwota} zł`);
}

async function handleAdminPrzejmij(interaction) {
  // Sprawdź uprawnienia przed sprawdzaniem kanału
  if (!isAdminOrSeller(interaction.member)) {
    await interaction.reply({
      content: "> `❗` × Brak wymaganych uprawnień.",
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const channel = interaction.channel;
  if (!isTicketChannel(channel)) {
    await interaction.reply({
      content: "> `❌` × **Użyj** komendy w kanale **ticketu**.",
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }
  await ticketClaimCommon(interaction, channel.id); // quiz odpali się w środku
}

function getPurchaseTicketCategoryIdsForGuild(guild) {
  const guildCats = ticketCategories.get(guild.id) || {};
  const purchaseCategoryIds = new Set();

  for (const [key, value] of Object.entries(guildCats)) {
    if (key.startsWith("zakup-") && value) {
      purchaseCategoryIds.add(String(value));
    }
  }

  if (purchaseCategoryIds.size === 0) {
    for (const ch of guild.channels.cache.values()) {
      if (
        ch.type === ChannelType.GuildCategory &&
        ch.name &&
        ch.name.toLowerCase().includes("zakup")
      ) {
        purchaseCategoryIds.add(String(ch.id));
      }
    }
  }

  return purchaseCategoryIds;
}

async function runAutoPrzejmijSweep(guild, ownerId, ownerName, targetChannelId = null) {
  const purchaseCategoryIds = getPurchaseTicketCategoryIdsForGuild(guild);
  const CLAIMED_CATEGORY_ID = "1457446529395593338";
  const ARCHIVED_CATEGORY_ID = "1469059216303198261";
  const ownerMember = await guild.members.fetch(ownerId).catch(() => null);

  const stats = {
    claimedCount: 0,
    skippedNonPurchase: 0,
    skippedClaimed: 0,
    skippedLocked: 0,
    skippedArchived: 0,
    staleRemoved: 0,
    errorCount: 0,
    claimedChannels: [],
    missingPurchaseCategories: purchaseCategoryIds.size === 0,
  };

  if (stats.missingPurchaseCategories) return stats;

  const nick = (ownerName || ownerMember?.displayName || "Wlasciciel")
    .toString()
    .replace(/`/g, "")
    .trim();

  const fakeInteraction = {
    user: { id: ownerId, username: nick || "Wlasciciel" },
    member: ownerMember,
    guild,
    replied: true,
    deferred: true,
    isButton: () => false,
    reply: async () => null,
    followUp: async () => null,
    editReply: async () => null,
    deleteReply: async () => null,
    deferReply: async () => null,
    deferUpdate: async () => null,
    showModal: async () => null,
  };

  for (const [channelId] of ticketOwners.entries()) {
    if (targetChannelId && channelId !== targetChannelId) continue;

    let channel = guild.channels.cache.get(channelId) || null;
    if (!channel) channel = await client.channels.fetch(channelId).catch(() => null);

    if (!channel) {
      ticketOwners.delete(channelId);
      stats.staleRemoved += 1;
      continue;
    }

    if (
      !channel.guild ||
      channel.guild.id !== guild.id ||
      channel.type !== ChannelType.GuildText
    ) {
      continue;
    }

    const parentId = channel.parentId ? String(channel.parentId) : "";
    if (parentId === ARCHIVED_CATEGORY_ID) {
      stats.skippedArchived += 1;
      continue;
    }
    if (parentId === CLAIMED_CATEGORY_ID) {
      stats.skippedClaimed += 1;
      continue;
    }
    if (!purchaseCategoryIds.has(parentId)) {
      stats.skippedNonPurchase += 1;
      continue;
    }

    const result = await ticketClaimCommon(fakeInteraction, channel.id, {
      skipQuiz: true,
      bypassPermissionCheck: true,
      publicClaimerLabel: `<@${ownerId}>`,
    });

    if (result && result.ok) {
      stats.claimedCount += 1;
      stats.claimedChannels.push(`<#${channel.id}>`);
      continue;
    }

    const reason = result?.reason || "error";
    if (reason === "already-claimed") {
      stats.skippedClaimed += 1;
    } else if (reason === "locked") {
      stats.skippedLocked += 1;
    } else if (reason === "channel-not-found") {
      stats.staleRemoved += 1;
    } else {
      stats.errorCount += 1;
    }
  }

  if (stats.staleRemoved > 0) scheduleSavePersistentState();
  return stats;
}

function formatAutoPrzejmijSummary(stats, statusLine) {
  const lines = [];
  if (statusLine) lines.push(statusLine);

  if (stats.missingPurchaseCategories) {
    lines.push("> `❌` × Nie znalazlem kategorii ticketow zakupowych.");
    return lines.join("\n");
  }

  lines.push(`> \`✅\` × Przejete tickety zakupowe: **${stats.claimedCount}**.`);
  lines.push(`> \`⏭️\` × Pominiete nie-zakupowe: **${stats.skippedNonPurchase}**.`);
  lines.push(`> \`⏭️\` × Pominiete (juz przejete): **${stats.skippedClaimed}**.`);
  lines.push(`> \`⏭️\` × Pominiete (zablokowane): **${stats.skippedLocked}**.`);
  lines.push(`> \`⏭️\` × Pominiete (zrealizowane): **${stats.skippedArchived}**.`);

  if (stats.staleRemoved > 0) {
    lines.push(`> \`🧹\` × Usuniete nieaktualne wpisy: **${stats.staleRemoved}**.`);
  }
  if (stats.errorCount > 0) {
    lines.push(`> \`⚠️\` × Bledy podczas przejmowania: **${stats.errorCount}**.`);
  }
  if (stats.claimedChannels.length > 0) {
    const preview = stats.claimedChannels.slice(0, 10).join(", ");
    const more =
      stats.claimedChannels.length > 10
        ? ` (+${stats.claimedChannels.length - 10} wiecej)`
        : "";
    lines.push(`> \`📌\` × Przejete kanaly: ${preview}${more}`);
  }
  return lines.join("\n");
}

async function maybeAutoPrzejmijNewTicket(guild, channelId) {
  const cfg = autoPrzejmijSettings.get(guild.id);
  if (!cfg || !cfg.enabled) return;

  if (cfg.ownerId !== guild.ownerId) {
    autoPrzejmijSettings.delete(guild.id);
    scheduleSavePersistentState();
    return;
  }

  const ownerMember = await guild.members.fetch(cfg.ownerId).catch(() => null);
  const ownerName = ownerMember?.displayName || cfg.ownerName || "Wlasciciel";

  if (cfg.ownerName !== ownerName) {
    cfg.ownerName = ownerName;
    autoPrzejmijSettings.set(guild.id, cfg);
    scheduleSavePersistentState();
  }

  await runAutoPrzejmijSweep(guild, cfg.ownerId, ownerName, channelId).catch(
    (err) => console.error("[autoprzejmij] Auto-claim nowego ticketa nieudany:", err),
  );
}

async function handleAutoPrzejmijCommand(interaction) {
  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({
      content: "> `❌` × Ta komenda dziala tylko na serwerze.",
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  if (interaction.user.id !== guild.ownerId) {
    await interaction.reply({
      content: "> `❌` × Tej komendy moze uzyc tylko wlasciciel serwera.",
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const modeSel = interaction.options.getString("status", true);
  const guildId = guild.id;

  if (modeSel === "wylacz") {
    autoPrzejmijSettings.delete(guildId);
    scheduleSavePersistentState();
    await interaction.reply({
      content: "> `✅` × Autoprzejmowanie zostalo **wylaczone**.",
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const quizQuestions = [
    { q: "Ile to 5 * 3?", a: "15" },
    { q: "Ile to 3 * 3?", a: "9" },
    { q: "Ile to 4 * 6?", a: "24" },
    { q: "Ile to 7 + 8?", a: "15" },
    { q: "Ile to 12 - 5?", a: "7" },
    { q: "Ile to 9 + 6?", a: "15" },
    { q: "Ile to 14 - 8?", a: "6" },
    { q: "Ile to 6 * 4?", a: "24" },
    { q: "Ile to 5 + 9?", a: "14" },
  ];
  const pick = quizQuestions[Math.floor(Math.random() * quizQuestions.length)];
  const modalId = `autoprzejmij_quiz_${guildId}_${interaction.user.id}_${Date.now()}`;

  pendingAutoPrzejmijQuiz.set(modalId, {
    guildId,
    userId: interaction.user.id,
    ownerId: interaction.user.id,
    ownerName:
      interaction.member?.displayName ||
      interaction.user.globalName ||
      interaction.user.username,
    answer: pick.a,
  });

  const modal = new ModalBuilder()
    .setCustomId(modalId)
    .setTitle("Weryfikacja autoprzejmowania");
  const input = new TextInputBuilder()
    .setCustomId("autoprzejmij_answer")
    .setLabel(pick.q)
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(4);
  modal.addComponents(new ActionRowBuilder().addComponents(input));

  await interaction.showModal(modal).catch(async () => {
    pendingAutoPrzejmijQuiz.delete(modalId);
    await interaction.reply({
      content: "> `❌` × Nie udalo sie otworzyc captcha. Sprobuj ponownie.",
      flags: [MessageFlags.Ephemeral],
    }).catch(() => null);
  });
}

async function handlePanelKalkulatorCommand(interaction) {
  if (!interaction.guild) {
    await interaction.reply({
      content: "> `❌` × **Ta komenda** działa tylko na **serwerze**.",
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // Sprawdź czy właściciel
  if (interaction.user.id !== interaction.guild.ownerId) {
    await interaction.reply({
      content: "> `❗` × Brak wymaganych uprawnień.",
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(COLOR_BLUE)
    .setDescription(
      "```\n" +
      "🧮 New Shop × Kalkulator\n" +
      "```\n" +
      "> <a:arrowwhite:1469100658606211233> × **Oblicz w szybki i prosty sposób ile otrzymasz lub ile musisz dać aby dostać określoną ilość __waluty__**",
    );

  const btnIleOtrzymam = new ButtonBuilder()
    .setCustomId("kalkulator_ile_otrzymam")
    .setLabel("Ile otrzymam?")
    .setStyle(ButtonStyle.Secondary);

  const btnIleMuszeDac = new ButtonBuilder()
    .setCustomId("kalkulator_ile_musze_dac")
    .setLabel("Ile muszę dać?")
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder().addComponents(
    btnIleOtrzymam,
    btnIleMuszeDac,
  );

  await interaction.reply({
    content: "> `✅` × **Panel** kalkulatora został wysłany na ten **kanał**.",
    flags: [MessageFlags.Ephemeral],
  });

  await interaction.channel.send({ embeds: [embed], components: [row] });
}

async function handleAdminOdprzejmij(interaction) {
  // Sprawdź uprawnienia przed sprawdzaniem kanału
  if (!isAdminOrSeller(interaction.member)) {
    await interaction.reply({
      content: "> `❗` × Brak wymaganych uprawnień.",
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const channel = interaction.channel;
  if (!isTicketChannel(channel)) {
    await interaction.reply({
      content: "> `❌` × **Użyj** komendy w kanale **ticketu**.",
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }
  await ticketUnclaimCommon(interaction, channel.id, null, { reason: null });
}

/*
  UPDATED: Interactive /sendmessage handler
  Flow:
  - Admin uses /sendmessage [kanal optional]
  - Bot replies ephemeral asking the admin to send the message content in the same channel within 2 minutes.
  - Admin posts the message (can include animated emoji like <a:name:id>, images/GIFs as attachments).
  - Bot forwards the submitted content + attachments + embeds to the target channel as a single EMBED with blue color.
*/
async function handleSendMessageCommand(interaction) {
  // Sprawdź czy właściciel
  if (interaction.user.id !== interaction.guild.ownerId) {
    await interaction.reply({
      content: "> `❗` × Brak wymaganych uprawnień.",
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // Target channel (optional)
  const targetChannel =
    interaction.options.getChannel("kanal") || interaction.channel;

  if (!targetChannel || targetChannel.type !== ChannelType.GuildText) {
    await interaction.reply({
      content: "> `❌` × **Wybierz** poprawny kanał tekstowy **docelowy**.",
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // Ask user to send the message they want forwarded
  try {
    await interaction.reply({
      content:
        "✉️ Napisz w tym kanale (w ciągu 2 minut) wiadomość, którą mam wysłać w docelowym kanale.\n" +
        `Docelowy kanał: <#${targetChannel.id}>\n\n` +
        "Możesz wysłać tekst (w tym animowane emoji w formacie `<a:nazwa:id>`), załączyć GIF/obraz, lub wkleić emoji. Wpisz `anuluj`, aby przerwać.",
      flags: [MessageFlags.Ephemeral],
    });
  } catch (e) {
    console.error("handleSendMessageCommand: reply failed", e);
    return;
  }

  const collectChannel = interaction.channel;
  if (!collectChannel || !collectChannel.createMessageCollector) {
    await interaction.followUp({
      content:
        "❌ Nie mogę uruchomić kolektora w tym kanale. Spróbuj ponownie.",
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const filter = (m) => m.author.id === interaction.user.id && !m.author.bot;
  const collector = collectChannel.createMessageCollector({
    filter,
    time: 120_000,
    max: 1,
  });

  collector.on("collect", async (msg) => {
    const contentRaw = (msg.content || "").trim();
    const arrowEmoji = '<a:arrowwhite:1469100658606211233>';
    const alertEmoji = '<a:alert:1474431227972026469>';
    const starEmoji = '<:star:1474431260133691567>';
    const content = contentRaw
      .replace(/:strzałka:/gi, arrowEmoji)
      .replace(/:alertownik:/gi, alertEmoji)
      .replace(/:startownik:/gi, starEmoji);
    if (content.toLowerCase() === "anuluj") {
      try {
        await interaction.followUp({
          content: "> `❌` × **Anulowano** wysyłanie wiadomości.",
          flags: [MessageFlags.Ephemeral],
        });
      } catch (e) { }
      collector.stop("cancelled");
      return;
    }

    // Prepare files from attachments:
    const files = [];
    let imageAttachment = null;
    for (const att of msg.attachments.values()) {
      if (att.contentType && att.contentType.startsWith('image/')) {
        imageAttachment = att.url;
      } else {
        files.push(att.url);
      }
    }

    // Build embed with blue color to send as the message (user requested)
    const sendEmbed = new EmbedBuilder()
      .setColor(COLOR_BLUE)
      .setDescription((content || "`(brak treści)`").replace(/<@!?\d+>|@everyone|@here/g, ''))
      .setTimestamp();
    
    // Add image to embed if present
    if (imageAttachment) {
      sendEmbed.setImage(imageAttachment);
    }

    // Forward embeds if the user pasted/embeded some
    const userEmbeds = msg.embeds?.length
      ? msg.embeds.map((e) => e.toJSON())
      : [];

    try {
      // Send to the target channel as embed + attachments (attachments included directly)
      const sendOptions = {
        embeds: [sendEmbed],
        files: files.length ? files : undefined,
      };
      
      // Extract pings from content and send as separate message
      const pings = content.match(/<@!?\d+>|@everyone|@here/g);
      if (pings && pings.length > 0) {
        await targetChannel.send({ content: pings.join(' ') });
      }
      
      await targetChannel.send(sendOptions);

      // If the user also had embeds, append them as a follow-up (optional)
      if (userEmbeds.length) {
        try {
          await targetChannel.send({ embeds: userEmbeds });
        } catch (e) {
          // ignore
        }
      }

      await interaction.followUp({
        content: `✅ Wiadomość została wysłana do <#${targetChannel.id}>.`,
        flags: [MessageFlags.Ephemeral],
      });
    } catch (err) {
      console.error("handleSendMessageCommand: send failed", err);
      try {
        await interaction.followUp({
          content:
            "❌ Nie udało się wysłać wiadomości (sprawdź uprawnienia bota do wysyłania wiadomości/załączników).",
          flags: [MessageFlags.Ephemeral],
        });
      } catch (e) { }
    } finally {
      // Optionally delete the user's message to keep the channel clean. Uncomment if desired.
      // try { await msg.delete().catch(()=>null); } catch(e){}
    }
  });

  collector.on("end", async (collected, reason) => {
    if (reason === "time" && collected.size === 0) {
      try {
        await interaction.followUp({
          content:
            "⌛ Nie otrzymałem wiadomości w wyznaczonym czasie. Użyj ponownie /sendmessage aby spróbować jeszcze raz.",
          flags: [MessageFlags.Ephemeral],
        });
      } catch (e) { }
    }
  });
}

async function handleModyCommand(interaction) {
  if (!interaction.guild) {
    await interaction.reply({
      content: "> `❌` × **Ta komenda** działa tylko na **serwerze**.",
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // Owner-only
  if (interaction.user.id !== interaction.guild.ownerId) {
    await interaction.reply({
      content: "> `❗` × Brak wymaganych uprawnień.",
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const targetChannel =
    interaction.options.getChannel("kanal") || interaction.channel;

  if (!targetChannel || targetChannel.type !== ChannelType.GuildText) {
    await interaction.reply({
      content: "> `❌` × **Wybierz** poprawny kanał tekstowy **docelowy**.",
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  try {
    await interaction.reply({
      content:
        "✉️ Napisz w tym kanale (w ciągu 2 minut) wiadomość, którą mam wysłać z przyciskiem **Nagrania modów**.\n" +
        `Docelowy kanał: <#${targetChannel.id}>\n\n` +
        "Możesz wysłać tekst, obraz/GIF i animowane emoji. Wpisz `anuluj`, aby przerwać.",
      flags: [MessageFlags.Ephemeral],
    });
  } catch (e) {
    console.error("handleModyCommand: reply failed", e);
    return;
  }

  const collectChannel = interaction.channel;
  if (!collectChannel || !collectChannel.createMessageCollector) {
    await interaction.followUp({
      content: "❌ Nie mogę uruchomić kolektora w tym kanale. Spróbuj ponownie.",
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const filter = (m) => m.author.id === interaction.user.id && !m.author.bot;
  const collector = collectChannel.createMessageCollector({
    filter,
    time: 120_000,
    max: 1,
  });

  collector.on("collect", async (msg) => {
    const contentRaw = (msg.content || "").trim();
    const arrowEmoji = "<a:arrowwhite:1469100658606211233>";
    const alertEmoji = "<a:alert:1474431227972026469>";
    const starEmoji = "<:star:1474431260133691567>";
    const content = contentRaw
      .replace(/:strzałka:/gi, arrowEmoji)
      .replace(/:alertownik:/gi, alertEmoji)
      .replace(/:startownik:/gi, starEmoji);

    if (content.toLowerCase() === "anuluj") {
      try {
        await interaction.followUp({
          content: "> `❌` × **Anulowano** wysyłanie wiadomości.",
          flags: [MessageFlags.Ephemeral],
        });
      } catch (e) { }
      collector.stop("cancelled");
      return;
    }

    const files = [];
    let imageAttachment = null;
    for (const att of msg.attachments.values()) {
      if (att.contentType && att.contentType.startsWith("image/")) {
        imageAttachment = att.url;
      } else {
        files.push(att.url);
      }
    }

    const sendEmbed = new EmbedBuilder()
      .setColor(COLOR_BLUE)
      .setDescription(
        (content || "`(brak treści)`").replace(/<@!?\d+>|@everyone|@here/g, ""),
      )
      .setTimestamp();

    if (imageAttachment) {
      sendEmbed.setImage(imageAttachment);
    }

    const videosButton = new ButtonBuilder()
      .setCustomId(`mody_videos_${Date.now()}`)
      .setLabel("Nagrania modów")
      .setEmoji("📹")
      .setStyle(ButtonStyle.Secondary);
    const buyModButton = new ButtonBuilder()
      .setCustomId(`mody_buy_${Date.now()}`)
      .setLabel("Zakup moda")
      .setEmoji("🛒")
      .setStyle(ButtonStyle.Secondary);
    const row = new ActionRowBuilder().addComponents(videosButton, buyModButton);

    try {
      const sendOptions = {
        embeds: [sendEmbed],
        components: [row],
        files: files.length ? files : undefined,
      };

      const pings = content.match(/<@!?\d+>|@everyone|@here/g);
      if (pings && pings.length > 0) {
        await targetChannel.send({ content: pings.join(" ") });
      }

      await targetChannel.send(sendOptions);

      await interaction.followUp({
        content: `✅ Wiadomość z przyciskiem modów została wysłana do <#${targetChannel.id}>.`,
        flags: [MessageFlags.Ephemeral],
      });
    } catch (err) {
      console.error("handleModyCommand: send failed", err);
      try {
        await interaction.followUp({
          content:
            "❌ Nie udało się wysłać wiadomości (sprawdź uprawnienia bota do wysyłania wiadomości/załączników).",
          flags: [MessageFlags.Ephemeral],
        });
      } catch (e) { }
    }
  });

  collector.on("end", async (collected, reason) => {
    if (reason === "time" && collected.size === 0) {
      try {
        await interaction.followUp({
          content:
            "⌛ Nie otrzymałem wiadomości w wyznaczonym czasie. Użyj ponownie /mody, aby spróbować jeszcze raz.",
          flags: [MessageFlags.Ephemeral],
        });
      } catch (e) { }
    }
  });
}

async function handleDropCommand(interaction) {
  const user = interaction.user;
  const guildId = interaction.guildId;

  // Now require guild and configured drop channel
  if (!guildId) {
    await interaction.reply({
      content: "> `❌` × **Ta komenda** działa tylko na **serwerze**!",
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const dropChannelId = dropChannels.get(guildId);
  if (!dropChannelId) {
    await interaction.reply({
      content:
        "❌ Kanał drop nie został ustawiony. Administrator może ustawić go manualnie lub utworzyć kanał o nazwie domyślnej.",
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  if (interaction.channelId !== dropChannelId) {
    await interaction.reply({
      content: `> \`❌\` × Użyj tej **komendy** na kanale <#${dropChannelId}>`,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // Enforce per-user cooldown for /drop (24h)
  const lastDrop = dropCooldowns.get(user.id) || 0;
  const now = Date.now();
  if (now - lastDrop < DROP_COOLDOWN_MS) {
    const remaining = DROP_COOLDOWN_MS - (now - lastDrop);
    await interaction.reply({
      content: `> \`❌\` × Możesz użyć komendy </drop:1464015494876102748> ponownie za \`${humanizeMs(remaining)}\``,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // reduce drop chances (smaller chance to win)
  const chance = Math.random() * 100;

  let result;
  // Lower probabilities (smaller chance to win)
  if (chance < 0.5) {
    result = { win: true, discount: 10 };
  } else if (chance < 5) {
    result = { win: true, discount: 5 };
  } else {
    result = { win: false };
  }

  // Register use (start cooldown) regardless of win/lose
  dropCooldowns.set(user.id, Date.now());

  // we'll need the channel object to manage the instruction message after replying
  const channel = interaction.channel;

  if (result.win) {
    const code = generateCode();
    const expiryTime = Date.now() + 86400000;
    const expiryTimestamp = Math.floor(expiryTime / 1000);

    activeCodes.set(code, {
      oderId: user.id,
      discount: result.discount,
      expiresAt: expiryTime,
      created: Date.now(),
      type: "discount",
    });
    
    // Zapisz do Supabase
    await db.saveActiveCode(code, {
      oderId: user.id,
      discount: result.discount,
      expiresAt: expiryTime,
      created: Date.now(),
      type: "discount"
    });

    scheduleSavePersistentState();

    setTimeout(() => {
      activeCodes.delete(code);
      db.deleteActiveCode(code);
      scheduleSavePersistentState();
    }, 86400000);

    const winEmbed = new EmbedBuilder()
      .setColor(0xd4af37) // yellow for win
      .setDescription(
        "```\n" +
        "🎀 New Shop × DROP\n" +
        "```\n" +
        `\`👤\` × **Użytkownik:** ${user}\n` +
        `\`🎉\` × **Gratulacje! Udało ci się wylosować -${result.discount}% na zakupy w naszym sklepie!**\n` +
        `\`⏰\` × **Zniżka wygasa:** <t:${expiryTimestamp}:R>\n\n` +
        `📩 **Sprawdź prywatne wiadomości po kod!**`,
      )
      .setTimestamp();

    const dmEmbed = new EmbedBuilder()
      .setColor(0xd4af37)
      .setTitle("\`🔑\` Twój kod rabatowy")
      .setDescription(
        "```\n" +
        code +
        "\n```\n" +
        `> \`💸\` × **Otrzymałeś:** \`-${result.discount}%\`\n` +
        `> \`🕑\` × **Kod wygaśnie za:** <t:${expiryTimestamp}:R> \n\n` +
        `> \`❔\` × Aby zrealizować kod utwórz nowy ticket, wybierz kategorię\n` +
        `> \`Zakup\` i kliknij przycisk \`Kod rabatowy\``,
      )
      .setTimestamp();

    try {
      await user.send({ embeds: [dmEmbed] });
      await interaction.reply({ embeds: [winEmbed] });
    } catch (error) {
      const winEmbedWithCode = new EmbedBuilder()
        .setColor(COLOR_YELLOW)
        .setDescription(
          "```\n" +
          "🎀 New Shop × DROP\n" +
          "```\n" +
          `\`👤\` × **Użytkownik:** ${user}\n` +
          `\`🎉\` × **Gratulacje! Udało ci się wylosować -${result.discount}% na zakupy w sklepie!**\n` +
          `\`🔑\` × **Twój kod:** ||\`${code}\`|| (kliknij aby odkryć)\n` +
          `\`⏰\` × **Zniżka wygasa:** <t:${expiryTimestamp}:R>`,
        )
        .setTimestamp();
      await interaction.reply({ embeds: [winEmbedWithCode], flags: [MessageFlags.Ephemeral] });
    }
  } else {
    const loseEmbed = new EmbedBuilder()
      .setColor(COLOR_GRAY) // gray for lose
      .setDescription(
        "```\n" +
        "🎀 New Shop × DROP\n" +
        "```\n" +
        `\`👤\` × **Użytkownik:** ${user}\n` +
        `\`😢\` × **Niestety, tym razem nie udało się! Spróbuj ponownie później...**`,
      )
      .setTimestamp();

    await interaction.reply({ embeds: [loseEmbed] });
  }

  // Manage drop instruction message: delete previous and send a fresh one so it moves to the bottom
  try {
    if (channel && channel.id) {
      // delete previous instruction if present
      const prevInstrId = lastDropInstruction.get(channel.id);
      if (prevInstrId) {
        try {
          const prevMsg = await channel.messages
            .fetch(prevInstrId)
            .catch(() => null);
          if (prevMsg && prevMsg.deletable) {
            await prevMsg.delete().catch(() => null);
          }
        } catch (err) {
          // ignore
        }
        lastDropInstruction.delete(channel.id);
      }

      // send new instruction embed
      const instructionDropEmbed = new EmbedBuilder()
        .setColor(COLOR_YELLOW)
        .setDescription(
          "`🎁` × Użyj **komendy** </drop:1464015494876102748>, aby wylosować zniżkę na zakupy!",
        );

      try {
        const sent = await channel.send({ embeds: [instructionDropEmbed] });
        lastDropInstruction.set(channel.id, sent.id);
      } catch (err) {
        // ignore (no perms)
      }
    }
  } catch (e) {
    console.error("Błąd zarządzania instrukcją drop:", e);
  }
}

async function handleOpinieKanalCommand(interaction) {
  const channel = interaction.options.getChannel("kanal");
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({
      content: "> `❌` × **Ta komenda** działa tylko na **serwerze**!",
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  opinieChannels.set(guildId, channel.id);
  await interaction.reply({
    content: `✅ Kanał opinii ustawiony na <#${channel.id}>`,
    flags: [MessageFlags.Ephemeral],
  });
  console.log(`Kanał opinii ustawiony na ${channel.id} dla serwera ${guildId}`);
}

async function handlePanelWeryfikacjaCommand(interaction) {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({
      content: "> `❌` × **Ta komenda** działa tylko na **serwerze**!",
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // Sprawdź czy właściciel
  if (interaction.user.id !== interaction.guild.ownerId) {
    await interaction.reply({
      content: "> `❗` × Brak wymaganych uprawnień.",
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const roleId = "1425935544273338532";
  // lokalna ścieżka do pliku GIF w folderze attached_assets
  const gifPath = path.join(
    __dirname,
    "attached_assets",
    "standard_(1)_1766946611653.gif",
  );
  let attachment = null;

  try {
    // dołączamy plik i nadajemy mu prostą nazwę, której użyjemy w embed (attachment://standard_1.gif)
    attachment = new AttachmentBuilder(gifPath, { name: "standard_1.gif" });
  } catch (err) {
    console.warn("Nie udało się załadować lokalnego GIFa:", err);
    attachment = null;
  }

  const embed = new EmbedBuilder()
    .setColor(COLOR_BLUE)
    .setDescription(
      "```\n" +
      "🛒 New Shop × WERYFIKACJA\n" +
      "```\n" +
      `<a:arrowwhite:1469100658606211233> **Kliknij w przycisk** na dole, **aby przejdź prostą** zagadkę\n` +
      `<a:arrowwhite:1469100658606211233> **matematyczną** i **otrzymać** rolę **klient.**`,
    )
    // jeśli plik lokalny załadowany - użyj attachment://..., w przeciwnym wypadku fallback na zdalny URL
    .setImage(
      attachment
        ? "attachment://standard_1.gif"
        : "https://cdn.discordapp.com/attachments/1449367698374004869/1450192787894046751/standard_1.gif",
    );

  const button = new ButtonBuilder()
    .setCustomId(`verify_panel_${interaction.channelId}_${Date.now()}`)
    .setStyle(ButtonStyle.Secondary) // niebieski
    .setEmoji("📝");

  const row = new ActionRowBuilder().addComponents(button);

  try {
    // Defer reply na początku, aby uniknąć Unknown interaction
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    const sendOptions = {
      embeds: [embed],
      components: [row],
      allowedMentions: { roles: [roleId] },
    };
    if (attachment) sendOptions.files = [attachment];

    await interaction.channel.send(sendOptions);

    await interaction.editReply({
      content: "> `✅` × **Panel** weryfikacji wysłany na ten **kanał**.",
    });
    console.log(
      `Wysłano panel weryfikacji na kanale ${interaction.channelId} (serwer ${guildId})`,
    );
  } catch (err) {
    console.error("Błąd wysyłania panelu weryfikacji:", err);
    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.editReply({
          content:
            "❌ Nie udało się wysłać panelu weryfikacji (sprawdź uprawnienia lub ścieżkę do pliku).",
        });
      } else {
        await interaction.reply({
          content:
            "❌ Nie udało się wysłać panelu weryfikacji (sprawdź uprawnienia lub ścieżkę do pliku).",
          flags: [MessageFlags.Ephemeral],
        });
      }
    } catch (e) {
      // ignore
    }
  }
}

async function handleTicketCommand(interaction) {
  const botName = client.user?.username || "NEWSHOP";

  const embed = new EmbedBuilder()
    .setColor(COLOR_BLUE)
    .setDescription(
      "```\n" +
      "🛒 New Shop × TICKET\n" +
      "```\n" +
      `📦 × Wybierz odpowiednią kategorię, aby utworzyć ticketa!`,
    );

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId("ticket_category")
    .setPlaceholder("Wybierz kategorię...")
    .addOptions([
      {
        label: "💰 Zakup",
        value: "zakup",
        description: "Chcę kupić przedmioty",
      },
      {
        label: "💵 Sprzedaż",
        value: "sprzedaz",
        description: "Chcę sprzedać przedmioty",
      },
      {
        label: "🎁 Nagroda za zaproszenia",
        value: "odbior",
        description: "Odbiór nagrody za zaproszenia (kod)",
      },
      {
        label: "🏆 Nagroda za konkurs",
        value: "konkurs_odbior",
        description: "Odbiór nagrody za konkurs",
      },
      { label: "❓ INNE", value: "inne", description: "Kliknij, aby zadać inne pytanie!" },
    ]);

  const row = new ActionRowBuilder().addComponents(selectMenu);

  await interaction.reply({
    embeds: [embed],
    components: [row],
    flags: [MessageFlags.Ephemeral],
  });
}

async function handleTicketPanelCommand(interaction) {
  // Sprawdź czy właściciel
  if (interaction.user.id !== interaction.guild.ownerId) {
    await interaction.reply({
      content: "> `❗` × Brak wymaganych uprawnień.",
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const botName = client.user?.username || "NEWSHOP";

  const embed = new EmbedBuilder()
    .setColor(COLOR_BLUE)
    .setDescription(
      "```\n" +
      "🛒 New Shop × TICKET\n" +
      "```\n" +
      "`📩` × Wybierz odpowiednią kategorię, aby utworzyć ticketa!",
    );

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId("ticket_category")
    .setPlaceholder("Wybierz kategorię...")
    .addOptions([
      {
        label: "💰 Zakup",
        value: "zakup",
        description: "Kliknij, aby dokonać zakupu!",
      },
      {
        label: "💵 Sprzedaż",
        value: "sprzedaz",
        description: "Kliknij, aby dokonać sprzedaży!",
      },
      {
        label: "🎁 Nagroda za zaproszenia",
        value: "odbior",
        description: "Kliknij, aby odebrać nagrode za zaproszenia (kod)",
      },
      {
        label: "🏆 Nagroda za konkurs",
        value: "konkurs_odbior",
        description: "Kliknij, aby odebrać nagrode za konkurs",
      },
      { label: "❓ INNE", value: "inne", description: "Kliknij, aby zadać inne pytanie!" },
    ]);

  const row = new ActionRowBuilder().addComponents(selectMenu);

  await interaction.reply({
    content: "> `✅` × **Panel** ticketów wysłany!",
    flags: [MessageFlags.Ephemeral],
  });

  await interaction.channel.send({ embeds: [embed], components: [row] });
}

async function handleCloseTicketCommand(interaction) {
  // Sprawdź uprawnienia przed sprawdzaniem kanału
  if (!isAdminOrSeller(interaction.member)) {
    await interaction.reply({
      content: "> `❗` × Brak wymaganych uprawnień.",
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const channel = interaction.channel;

  if (!isTicketChannel(channel)) {
    await interaction.reply({
      content: "> `❌` × Ta **komenda** działa jedynie na **ticketach**!",
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const chId = channel.id;
  const now = Date.now();
  const pending = pendingTicketClose.get(chId);

  if (
    pending &&
    pending.userId === interaction.user.id &&
    now - pending.ts < 30_000
  ) {
    pendingTicketClose.delete(chId);
    // remove ticketOwners entry immediately
    const ticketMeta = ticketOwners.get(chId) || null;
    ticketOwners.delete(chId);
    scheduleSavePersistentState();

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLOR_BLUE)
          .setDescription("> \`ℹ️\` × **Ticket zostanie zamknięty w ciągu 5 sekund...**")
      ]
    });

    try {
      await archiveTicketOnClose(
        channel,
        interaction.user.id,
        ticketMeta,
      ).catch((e) => console.error("archiveTicketOnClose error:", e));
    } catch (e) {
      console.error("Błąd archiwizacji ticketu (command):", e);
    }

    setTimeout(async () => {
      try {
        await channel.delete();
      } catch (error) {
        console.error("Błąd zamykania ticketu:", error);
      }
    }, 2000);
  } else {
    pendingTicketClose.set(chId, { userId: interaction.user.id, ts: now });
    await interaction.reply({
      content:
        "> \`⚠️\` Kliknij /zamknij ponownie w ciągu 30 sekund, aby potwierdzić zamknięcie ticketu.",
      flags: [MessageFlags.Ephemeral],
    });
    setTimeout(() => pendingTicketClose.delete(chId), 30_000);
  }
}

// ----------------- /ticket-zakoncz handler -----------------
async function handleTicketZakonczCommand(interaction) {
  // Sprawdź czy właściciel lub sprzedawca
  const isOwner = interaction.user.id === interaction.guild.ownerId;
  const SELLER_ROLE_ID = "1350786945944391733";
  const hasSellerRole = interaction.member.roles.cache.has(SELLER_ROLE_ID);
  
  if (!isOwner && !hasSellerRole) {
    await interaction.reply({
      content: "> `❗` × Brak wymaganych uprawnień.",
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const channel = interaction.channel;

  // Sprawdź czy komenda jest używana w tickecie
  if (!isTicketChannel(channel)) {
    await interaction.reply({
      content: "> `❌` × Ta **komenda** działa jedynie na **ticketach**!",
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // Pobierz parametry
  const typ = interaction.options.getString("typ");
  const ile = interaction.options.getString("ile");
  const serwer = interaction.options.getString("serwer");

  // Pobierz właściciela ticketu
  const ticketData = ticketOwners.get(channel.id);
  const ticketOwnerId = ticketData?.userId;

  if (!ticketOwnerId) {
    await interaction.reply({
      content: "> `❌` × **Nie udało się** zidentyfikować właściciela ticketu.",
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const legitRepChannelId = "1449840030947217529";
  const arrowEmoji = '<a:arrowwhite:1469100658606211233>';
  let thankLine = "Dziękujemy za zakup w naszym sklepie";
  let repVerb = "sprzedał";
  const typLower = typ.toLowerCase();
  if (typLower === "sprzedaż") {
    thankLine = "Dziękujemy za sprzedaż w naszym sklepie";
    repVerb = "kupił";
  } else if (typLower === "wręczył nagrodę") {
    thankLine = "Nagroda została nadana";
    repVerb = "wręczył nagrodę";
  }

  const repMessage = `+rep @${interaction.user.username} ${repVerb} ${ile} ${serwer}`;

  const embed = new EmbedBuilder()
    .setColor(COLOR_BLUE)
    .setDescription(
      "```\n" +
      "✅ New Shop × WYSTAW LEGIT CHECK\n" +
      "```\n" +
      `${arrowEmoji} **${thankLine}**\n\n` +
      `${arrowEmoji} **Aby zamknąć ticket wyślij legit checka na kanał**\n<#${legitRepChannelId}>\n\n` +
      `📋 **Wzór do skopiowania:**\n\`${repMessage}\``,
    )
    .setImage("attachment://standard_5.gif");

  const gifPath = path.join(__dirname, "attached_assets", "standard (5).gif");
  const gifAttachment = new AttachmentBuilder(gifPath, { name: "standard_5.gif" });

  // Ephemeral potwierdzenie dla sprzedawcy
  await interaction.reply({
    content: "`✅` × Poprawnie użyto komendy ticket zakończ.",
    flags: [MessageFlags.Ephemeral],
  });

  // Wyślij ping właściciela + embed + wzór (bez reply na slash)
  await interaction.channel.send({ content: `<@${ticketOwnerId}>` });

  await interaction.channel.send({
    embeds: [embed],
    files: [gifAttachment]
  });

  await interaction.channel.send({
    content: repMessage,
  });

  // Zapisz informację o oczekiwaniu na +rep dla tego ticketu
  pendingTicketClose.set(channel.id, {
    userId: ticketOwnerId, // właściciel ticketu musi wysłać +rep
    commandUserId: interaction.user.id, // osoba która użyła komendy
    commandUsername: interaction.user.username, // nick osoby która użyła komendy
    awaitingRep: true,
    legitRepChannelId,
    ts: Date.now()
  });

  // Przenieś ticket do kategorii zrealizowanej
  const ARCHIVED_CATEGORY_ID = "1469059216303198261";
  try {
    if (channel.parentId !== ARCHIVED_CATEGORY_ID) {
      await channel.setParent(ARCHIVED_CATEGORY_ID, { lockPermissions: false });
    }
  } catch (err) {
    console.error("Nie udało się przenieść ticketu do kategorii zrealizowanej:", err);
  }

  console.log(`Ticket ${channel.id} oczekuje na +rep od użytkownika ${ticketOwnerId} (komenda użyta przez ${interaction.user.username})`);
}

// ----------------- /zamknij-z-powodem handler -----------------
async function handleZamknijZPowodemCommand(interaction) {
  const channel = interaction.channel;

  // Sprawdź czy komenda jest używana w tickecie
  if (!isTicketChannel(channel)) {
    await interaction.reply({
      content: "> `❌` × Ta **komenda** działa jedynie na **ticketach**!",
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // Sprawdź czy właściciel
  if (interaction.user.id !== interaction.guild.ownerId) {
    await interaction.reply({
      content: "> `❗` × Brak wymaganych uprawnień.",
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // Pobierz powód
  const powodPreset = interaction.options.getString("powod");
  const powodCustom = (interaction.options.getString("powod_custom") || "").trim();
  const powod = powodCustom || powodPreset;

  // Pobierz właściciela ticketu
  const ticketData = ticketOwners.get(channel.id);
  const ticketOwnerId = ticketData?.userId;

  if (!ticketOwnerId) {
    await interaction.reply({
      content: "> `❌` × **Nie udało się** zidentyfikować właściciela ticketu.",
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  try {
    // Wyślij embed do właściciela ticketu
    const arrowEmoji = '<a:arrowwhite:1469100658606211233>';
    const embed = new EmbedBuilder()
      .setColor(COLOR_BLUE)
      .setDescription(
        "```\n" +
        "🎫 New Shop × TICKETY\n" +
        "```\n" +
        `${arrowEmoji} **Twój ticket został zamknięty z powodu:**\n> **\`${powod}\`**`
      )
      .setTimestamp();

    // Wyślij DM do właściciela ticketu
    const ticketOwner = await client.users.fetch(ticketOwnerId).catch(() => null);
    if (ticketOwner) {
      await ticketOwner.send({ embeds: [embed] }).catch(() => null);
    }

    // Wyślij potwierdzenie na kanał (publicznie)
    await interaction.reply({
      content: `> \`✅\` × Ticket zamknięty z powodem: **${powod}**`,
      flags: [MessageFlags.Ephemeral],
    });

    // Zamknij ticket po 2 sekundach
    setTimeout(async () => {
      try {
        await channel.delete(`Ticket zamknięty przez właściciela z powodem: ${powod}`);
        ticketOwners.delete(channel.id);
        pendingTicketClose.delete(channel.id);
        
        console.log(`Ticket ${channel.id} został zamknięty przez właściciela z powodem: ${powod}`);
      } catch (closeErr) {
        console.error(`Błąd zamykania ticketu ${channel.id}:`, closeErr);
      }
    }, 2000);

  } catch (error) {
    console.error("Błąd podczas zamykania ticketu z powodem:", error);
    await interaction.reply({
      content: "> `❌` × **Wystąpił** błąd podczas zamykania ticketu.",
      flags: [MessageFlags.Ephemeral],
    });
  }
}

// ----------------- /legit-rep-ustaw handler -----------------
async function handleLegitRepUstawCommand(interaction) {
  try {
    console.log("[/legit-rep-ustaw] start", {
      user: interaction.user?.id,
      guild: interaction.guild?.id,
    });

    // ensure we acknowledge the interaction to avoid "application did not respond"
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ ephemeral: true });
    }

    // Sprawdź czy właściciel
    if (interaction.user.id !== interaction.guild.ownerId) {
      const payload = { content: "> `❗` × Brak wymaganych uprawnień.", flags: [MessageFlags.Ephemeral] };
      if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
      else await interaction.reply(payload);
      return;
    }

    const ile = interaction.options.getInteger("ile");
    
    if (ile < 0 || ile > 9999) {
      const payload = { content: "> `❌` × **Podaj** liczbę od 0 do 9999.", flags: [MessageFlags.Ephemeral] };
      if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
      else await interaction.reply(payload);
      return;
    }

    // Zaktualizuj licznik
    legitRepCount = ile;
    
    // Zmień nazwę kanału
    const channelId = "1449840030947217529";
    const channel = await client.channels.fetch(channelId).catch((err) => {
      console.error("legit-rep-ustaw fetch channel error", err);
      return null;
    });
    
    if (!channel) {
      const payload = { content: "> `❌` × **Nie znaleziono** kanału legit-rep.", flags: [MessageFlags.Ephemeral] };
      if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
      else await interaction.reply(payload);
      return;
    }

    const newName = `✅-×┃legit-rep➔${ile}`;
    await channel.setName(newName);
    
    // Wyślij informacyjną wiadomość
    const successPayload = {
      content: `LegitRepy: ${ile}\nLegitChecki: ${ile}`,
      flags: [MessageFlags.Ephemeral],
    };
    if (interaction.deferred || interaction.replied) await interaction.editReply(successPayload);
    else await interaction.reply(successPayload);
    
    // Zapisz stan
    scheduleSavePersistentState();
    
    console.log(`Nazwa kanału legit-rep zmieniona na: ${newName} przez ${interaction.user.tag}`);
  } catch (error) {
    console.error("Błąd podczas ustawiania legit-rep (outer catch):", error);
    const payload = { content: "> `❌` × **Wystąpił** błąd podczas zmiany nazwy kanału.", flags: [MessageFlags.Ephemeral] };
    if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
    else await interaction.reply(payload);
  }
}

// ----------------- /sprawdz-kogo-zaprosil handler -----------------
async function handleSprawdzKogoZaprosilCommand(interaction) {
  // Sprawdź czy właściciel
  if (interaction.user.id !== interaction.guild.ownerId) {
    await interaction.reply({
      content: "> `❗` × Brak wymaganych uprawnień.",
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const targetUser = interaction.options.getUser("kto");
  if (!targetUser) {
    await interaction.reply({
      content: "> `❌` × **Nie udało się** zidentyfikować użytkownika.",
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  try {
    const guild = interaction.guild;
    const targetUserId = targetUser.id;
    
    // Pobierz zaproszenia z Supabase
    const invitedUsers = await db.getInvitedUsersByInviter(guild.id, targetUserId);
    
    if (invitedUsers.length === 0) {
      await interaction.reply({
        content: `> \`ℹ️\` × **Użytkownik** <@${targetUserId}> **nie ma żadnych aktywnych zaproszeń**.`,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    // Pobierz aktualnych członków serwera
    const guildMembers = await guild.members.fetch();
    const currentMemberIds = new Set(guildMembers.keys());

    // Filtruj tylko osoby które są nadal na serwerze
    let invitedList = [];
    
    for (const invitedUser of invitedUsers) {
      try {
        // Sprawdź czy użytkownik jest nadal na serwerze
        if (currentMemberIds.has(invitedUser.invited_user_id)) {
          const member = guildMembers.get(invitedUser.invited_user_id);
          
          // Sprawdź czy konto ma więcej niż 2 miesiące
          const accountAge = member.user.createdAt;
          const twoMonthsAgo = new Date(Date.now() - (60 * 24 * 60 * 60 * 1000)); // 60 dni
          
          if (accountAge && accountAge > twoMonthsAgo) {
            const joinedDate = invitedUser.created_at ? 
              new Date(invitedUser.created_at).toLocaleDateString('pl-PL') : 
              'Nieznana data';
            
            invitedList.push({
              user: member.user,
              date: joinedDate
            });
          }
        }
      } catch (err) {
        // Użytkownik opuścił serwer lub konto za młode - nie dodajemy do listy
        continue;
      }
    }

    // Usuń duplikaty z listy
    const uniqueInvites = [];
    const seenUsers = new Set();
    
    for (const item of invitedList) {
      if (item.user && !seenUsers.has(item.user.id)) {
        seenUsers.add(item.user.id);
        uniqueInvites.push(item);
      }
    }

    // Twórz embed
    const embed = new EmbedBuilder()
      .setColor(COLOR_BLUE)
      .setTitle("New Shop x Logi")
      .setDescription(`**Sprawdzasz:** <@${targetUserId}>\nUżytkownik zaprosił **${uniqueInvites.length}** osób`)
      .addFields({
        name: "--=--=--=--=LISTA=--=--=--=--=--=",
        value: uniqueInvites.length > 0 
          ? uniqueInvites.map(item => 
              `@${item.user.username} (${item.date})`
            ).join('\n')
          : "Brak aktywnych zaproszeń na serwerze"
      })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });

  } catch (error) {
    console.error("Błąd podczas sprawdzania zaproszonych osób:", error);
    await interaction.reply({
      content: "> `❌` × **Wystąpił** błąd podczas sprawdzania zaproszeń.",
      flags: [MessageFlags.Ephemeral],
    });
  }
}

async function handleSelectMenu(interaction) {
  // KALKULATOR select menu handlers
  if (interaction.customId === "kalkulator_tryb" || interaction.customId === "kalkulator_metoda") {
    await handleKalkulatorSelect(interaction);
    return;
  }

  // ticket category menu
  if (interaction.customId === "ticket_category") {
    const selectedCategory = interaction.values[0];

    switch (selectedCategory) {
      case "zakup":
        await showZakupModal(interaction);
        break;
      case "sprzedaz":
        await showSprzedazModal(interaction);
        break;
      case "odbior":
        await showOdbiorModal(interaction);
        break;
      case "konkurs_odbior":
        await showKonkursOdbiorModal(interaction);
        break;
      case "inne":
        await showInneModal(interaction);
        break;
      default:
        await interaction.reply({
          content: "> `❌` × **Nie wybrano** żadnej z kategorii!",
          flags: [MessageFlags.Ephemeral],
        });
    }
    return;
  }

  // ticket settings select handler
  if (interaction.customId.startsWith("ticket_settings_select_")) {
    const channelId = interaction.customId.replace(
      "ticket_settings_select_",
      "",
    );
    const chosen = interaction.values[0];

    // handle chosen action: open modal accordingly
    if (chosen === "rename") {
      const modal = new ModalBuilder()
        .setCustomId(`modal_rename_${channelId}`)
        .setTitle("Zmień nazwę ticketu");

      const nameInput = new TextInputBuilder()
        .setCustomId("new_ticket_name")
        .setLabel("Nowa nazwa kanału (np. ticket-nick)")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("ticket-nick")
        .setRequired(true)
        .setMinLength(3)
        .setMaxLength(90);

      modal.addComponents(new ActionRowBuilder().addComponents(nameInput));
      await interaction.showModal(modal);
      return;
    }

    if (chosen === "add") {
      const modal = new ModalBuilder()
        .setCustomId(`modal_add_${channelId}`)
        .setTitle("Dodaj użytkownika do ticketu");

      const userInput = new TextInputBuilder()
        .setCustomId("user_to_add")
        .setLabel("Wpisz @mention lub ID użytkownika")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("@użytkownik lub ID")
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(userInput));
      await interaction.showModal(modal);
      return;
    }

    if (chosen === "remove") {
      const modal = new ModalBuilder()
        .setCustomId(`modal_remove_${channelId}`)
        .setTitle("Usuń użytkownika z ticketu");

      const userInput = new TextInputBuilder()
        .setCustomId("user_to_remove")
        .setLabel("Wpisz @mention lub ID użytkownika")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("@użytkownik lub ID")
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(userInput));
      await interaction.showModal(modal);
      return;
    }

    await interaction.reply({ content: "> `❌` × **Nieznana** akcja.", flags: [MessageFlags.Ephemeral] });
    return;
  }
}

async function showZakupModal(interaction) {
  const modal = new ModalBuilder()
    .setCustomId("modal_zakup")
    .setTitle("Informacje dot. zakupu.");

  const serwerInput = new TextInputBuilder()
    .setCustomId("serwer")
    .setLabel("Na jakim serwerze?")
    .setPlaceholder("Przykład: Anarchia")
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const kwotaInput = new TextInputBuilder()
    .setCustomId("kwota")
    .setLabel("Za ile chcesz kupić?")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("Przykład: 20zł")
    .setRequired(true);

  const platnosInput = new TextInputBuilder()
    .setCustomId("platnosc")
    .setLabel("Jaką metodą płatności płacisz?")
    .setPlaceholder("Przykład: Blik")
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const oczekiwanaWalutaInput = new TextInputBuilder()
    .setCustomId("oczekiwana_waluta")
    .setLabel("Co chciałbyś zakupić")
    .setPlaceholder("Przykład: Elytra")
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder().addComponents(serwerInput),
    new ActionRowBuilder().addComponents(kwotaInput),
    new ActionRowBuilder().addComponents(platnosInput),
    new ActionRowBuilder().addComponents(oczekiwanaWalutaInput),
  );

  await interaction.showModal(modal);
}

async function showKonkursOdbiorModal(interaction) {
  const modal = new ModalBuilder()
    .setCustomId("modal_konkurs_odbior")
    .setTitle("Nagroda za konkurs");

  const infoInput = new TextInputBuilder()
    .setCustomId("konkurs_info")
    .setLabel("Za jaki konkurs oraz jaka nagroda?")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("Przykład: Wygrałem konkurs na elytre")
    .setRequired(true)
    .setMaxLength(128);

  modal.addComponents(new ActionRowBuilder().addComponents(infoInput));

  await interaction.showModal(modal);
}

async function ticketClaimCommon(interaction, channelId, opts = {}) {
  const isBtn = typeof interaction.isButton === "function" && interaction.isButton();
  const skipQuiz = opts.skipQuiz === true;
  const bypassPermissionCheck = opts.bypassPermissionCheck === true;

  if (!bypassPermissionCheck && !isAdminOrSeller(interaction.member)) {
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: "> `❗` × Brak wymaganych uprawnień.",
        flags: [MessageFlags.Ephemeral],
      });
    } else {
      await interaction.followUp({
        content: "> `❗` × Brak wymaganych uprawnień.",
        flags: [MessageFlags.Ephemeral],
      }).catch(() => null);
    }
    return { ok: false, reason: "permission" };
  }

  // quiz matematyczny przed przejęciem (przycisk + /przejmij)
  if (!skipQuiz) {
    const questions = [
      { q: "Ile to 5 * 3?", a: "15" },
      { q: "Ile to 3 * 3?", a: "9" },
      { q: "Ile to 4 * 6?", a: "24" },
      { q: "Ile to 7 + 8?", a: "15" },
      { q: "Ile to 12 - 5?", a: "7" },
      { q: "Ile to 9 + 6?", a: "15" },
      { q: "Ile to 14 - 8?", a: "6" },
      { q: "Ile to 6 * 4?", a: "24" },
      { q: "Ile to 5 + 9?", a: "14" },
    ];
    const pick = questions[Math.floor(Math.random() * questions.length)];
    const modalId = `claim_quiz_${channelId}_${interaction.user.id}_${Date.now()}`;
    pendingClaimQuiz.set(modalId, { channelId, userId: interaction.user.id, answer: pick.a });

    const modal = new ModalBuilder()
      .setCustomId(modalId)
      .setTitle("Weryfikacja przejęcia ticketu");
    const input = new TextInputBuilder()
      .setCustomId("claim_answer")
      .setLabel(pick.q)
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(4);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    await interaction.showModal(modal).catch(() => null);
    return { ok: false, reason: "quiz-required" };
  }

  // szybka odpowiedź, żeby Discord nie wyświetlał błędu interakcji (po quizie)
  if (!interaction.replied && !interaction.deferred) {
    if (isBtn) {
      await interaction.deferUpdate().catch(() => null);
    } else {
      await interaction.deferReply({ flags: [MessageFlags.Ephemeral] }).catch(() => null);
    }
  }

  const replyEphemeral = async (text) => {
    // jeśli interakcja nie została jeszcze potwierdzona, użyj reply()
    if (!interaction.replied && !interaction.deferred) {
      await interaction
        .reply({ content: text, flags: [MessageFlags.Ephemeral] })
        .catch(() => null);
      return;
    }
    if (isBtn) {
      await interaction.followUp({ content: text, flags: [MessageFlags.Ephemeral] }).catch(() => null);
    } else {
      await interaction.editReply({ content: text }).catch(() => null);
    }
  };

  const ticketData = ticketOwners.get(channelId) || {
    claimedBy: null,
    locked: false,
    userId: null,
    ticketMessageId: null,
    originalCategoryId: null, // Zapisz oryginalną kategorię
  };

  if (ticketData.locked) {
    await replyEphemeral(
      "❌ Ten ticket został zablokowany do przejmowania (ustawienia/zmiana nazwy).",
    );
    return { ok: false, reason: "locked" };
  }

  if (ticketData && ticketData.claimedBy) {
    await replyEphemeral(
      `❌ Ten ticket został już przejęty przez <@${ticketData.claimedBy}>!`,
    );
    return { ok: false, reason: "already-claimed", claimedBy: ticketData.claimedBy };
  }

  const ch = await client.channels.fetch(channelId).catch(() => null);
  if (!ch) {
    await replyEphemeral("❌ Nie mogę znaleźć tego kanału.");
    return { ok: false, reason: "channel-not-found" };
  }

  try {
    const claimerId = interaction.user.id;

    // Zapisz oryginalną kategorię przed przeniesieniem
    if (!ticketData.originalCategoryId) {
      ticketData.originalCategoryId = ch.parentId;
    }

    // Przenieś do kategorii TICKETY PRZEJĘTE
    const przejetaKategoriaId = "1457446529395593338";
    const przejetaKategoria = await client.channels.fetch(przejetaKategoriaId).catch(() => null);
    
    if (przejetaKategoria) {
      await ch.setParent(przejetaKategoriaId).catch((err) => {
        console.error("Błąd przenoszenia do kategorii TICKETY PRZEJĘTE:", err);
      });
      console.log(`Przeniesiono ticket ${channelId} do kategorii TICKETY PRZEJĘTE`);
    } else {
      console.error("Nie znaleziono kategorii TICKETY PRZEJĘTE (1457446529395593338)");
    }

    // Ustaw uprawnienia dla osoby przejmującej + właściciela ticketu
    const permissionOverwrites = [
      {
        id: claimerId,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
      },
      {
        id: interaction.guild.roles.everyone,
        deny: [PermissionFlagsBits.ViewChannel] // @everyone nie widzi gdy ktoś przejmie
      }
    ];

    // Dodaj właściciela ticketu do uprawnień
    if (ticketData && ticketData.userId) {
      permissionOverwrites.push({
        id: ticketData.userId,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
      });
    }

    await ch.permissionOverwrites.set(permissionOverwrites);

    // Usuń limity kategorii dla kanału
    const limitCategories = [
      "1449448705563557918", // limit 20
      "1449448702925209651", // limit 50
      "1449448686156255333", // limit 100
      "1449448860517798061"  // limit 200
    ];

    for (const categoryId of limitCategories) {
      const category = await client.channels.fetch(categoryId).catch(() => null);
      if (category && category.type === ChannelType.GuildCategory) {
        await category.permissionOverwrites.edit(ch.id, {
          ViewChannel: false,
          SendMessages: false,
          ReadMessageHistory: false
        }).catch(() => null);
      }
    }

    // Właściciel ticketu już ma dostęp - nie trzeba nic zmieniać
    // Usuń limity kategorii dla kanału

    ticketData.claimedBy = claimerId;
    ticketOwners.set(channelId, ticketData);
    scheduleSavePersistentState();

    if (ticketData && ticketData.ticketMessageId) {
      await editTicketMessageButtons(ch, ticketData.ticketMessageId, claimerId).catch(() => null);
    }

    const publicClaimerLabel =
      (typeof opts.publicClaimerLabel === "string" && opts.publicClaimerLabel.trim()) ||
      `<@${claimerId}>`;
    const publicEmbed = new EmbedBuilder()
      .setColor(COLOR_BLUE)
      .setDescription(`> \`✅\` × Ticket został przejęty przez ${publicClaimerLabel}`);

    try {
      const sent = await ch.send({ embeds: [publicEmbed] }).catch(() => null);
      if (sent && sent.id) {
        ticketData.lastClaimMsgId = sent.id;
        ticketOwners.set(channelId, ticketData);
        scheduleSavePersistentState();
      }
    } catch {
      // ignore
    }
    if (!isBtn) {
      await interaction.deleteReply().catch(() => null);
    }
    return { ok: true, reason: "claimed", channelId, claimedBy: claimerId };
  } catch (err) {
    console.error("Błąd przy przejmowaniu ticketu:", err);
    await replyEphemeral("❌ Wystąpił błąd podczas przejmowania ticketu.");
    return { ok: false, reason: "error", channelId };
  }
}

async function ticketUnclaimCommon(interaction, channelId, expectedClaimer = null) {
  const isBtn = typeof interaction.isButton === "function" && interaction.isButton();

  if (!isAdminOrSeller(interaction.member)) {
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: "> `❗` × Brak wymaganych uprawnień.",
        flags: [MessageFlags.Ephemeral],
      });
    } else {
      await interaction.followUp({
        content: "> `❗` × Brak wymaganych uprawnień.",
        flags: [MessageFlags.Ephemeral],
      }).catch(() => null);
    }
    return;
  }

  if (!interaction.replied && !interaction.deferred) {
    if (isBtn) {
      await interaction.deferUpdate().catch(() => null);
    } else {
      await interaction.deferReply({ flags: [MessageFlags.Ephemeral] }).catch(() => null);
    }
  }

  const replyEphemeral = async (text) => {
    if (isBtn) {
      await interaction.followUp({ content: text, flags: [MessageFlags.Ephemeral] }).catch(() => null);
    } else {
      await interaction.editReply({ content: text }).catch(() => null);
    }
  };

  const ticketData = ticketOwners.get(channelId) || {
    claimedBy: null,
    userId: null,
    ticketMessageId: null,
    originalCategoryId: null, // Dodaj oryginalną kategorię
  };

  const ch = await client.channels.fetch(channelId).catch(() => null);
  if (!ch) {
    await replyEphemeral("❌ Nie mogę znaleźć tego kanału.");
    return;
  }

  if (!ticketData.claimedBy) {
    await replyEphemeral("ℹ️ Ten ticket nie jest przejęty.");
    return;
  }

  if (
    expectedClaimer &&
    expectedClaimer !== interaction.user.id &&
    !isAdminOrSeller(interaction.member)
  ) {
    await replyEphemeral(
      "> `❗` Brak wymaganych uprawnień.",
    );
    return;
  }

  if (!interaction.replied && !interaction.deferred) {
    if (isBtn) {
      await interaction.deferUpdate().catch(() => null);
    } else {
      await interaction.deferReply({ flags: [MessageFlags.Ephemeral] }).catch(() => null);
    }
  }

  try {
    const releaserId = interaction.user.id;

    // Przywróć oryginalną kategorię jeśli istnieje
    if (ticketData.originalCategoryId) {
      const originalCategory = await client.channels.fetch(ticketData.originalCategoryId).catch(() => null);
      
      if (originalCategory) {
        await ch.setParent(ticketData.originalCategoryId).catch((err) => {
          console.error("Błąd przywracania oryginalnej kategorii:", err);
        });
        console.log(`Przywrócono ticket ${channelId} do oryginalnej kategorii ${ticketData.originalCategoryId}`);
      } else {
        console.error("Nie znaleziono oryginalnej kategorii:", ticketData.originalCategoryId);
      }
    }

    // Przywróć uprawnienia w zależności od oryginalnej kategorii
    if (ticketData.originalCategoryId) {
      const categoryId = ticketData.originalCategoryId;
      
      // Zakup 0-20 - wszystkie rangi widzą
      if (categoryId === "1449526840942268526") {
        await ch.permissionOverwrites.set([
          { id: interaction.guild.roles.everyone, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: "1449448705563557918", allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }, // limit 20
          { id: "1449448702925209651", allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }, // limit 50
          { id: "1449448686156255333", allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }, // limit 100
          { id: "1449448860517798061", allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }  // limit 200
        ]);
      }
      // Zakup 20-50 - limit 20 nie widzi
      else if (categoryId === "1449526958508474409") {
        await ch.permissionOverwrites.set([
          { id: interaction.guild.roles.everyone, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: "1449448702925209651", allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }, // limit 50
          { id: "1449448686156255333", allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }, // limit 100
          { id: "1449448860517798061", allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }  // limit 200
        ]);
      }
      // Zakup 50-100 - limit 20 i 50 nie widzą
      else if (categoryId === "1449451716129984595") {
        await ch.permissionOverwrites.set([
          { id: interaction.guild.roles.everyone, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: "1449448686156255333", allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }, // limit 100
          { id: "1449448860517798061", allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }  // limit 200
        ]);
      }
      // Zakup 100-200 - tylko limit 200 widzi
      else if (categoryId === "1449452354201190485") {
        await ch.permissionOverwrites.set([
          { id: interaction.guild.roles.everyone, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: "1449448860517798061", allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }  // limit 200
        ]);
      }
      // Sprzedaż - wszystkie rangi widzą
      else if (categoryId === "1449455848043708426") {
        await ch.permissionOverwrites.set([
          { id: interaction.guild.roles.everyone, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: "1449448705563557918", allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }, // limit 20
          { id: "1449448702925209651", allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }, // limit 50
          { id: "1449448686156255333", allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }, // limit 100
          { id: "1449448860517798061", allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }  // limit 200
        ]);
      }
      // Inne - wszystkie rangi widzą
      else if (categoryId === "1449527585271976131") {
        await ch.permissionOverwrites.set([
          { id: interaction.guild.roles.everyone, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: "1449448705563557918", allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }, // limit 20
          { id: "1449448702925209651", allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }, // limit 50
          { id: "1449448686156255333", allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }, // limit 100
          { id: "1449448860517798061", allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }  // limit 200
        ]);
      }
    }

    // Przywróć dostęp właścicielowi ticketu - zawsze musi widzieć
    if (ticketData && ticketData.userId) {
      await ch.permissionOverwrites.edit(ticketData.userId, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true,
      }).catch(() => null);
    }

    // Usuń uprawnienia osoby przejmującej
    if (ticketData.claimedBy) {
      await ch.permissionOverwrites.delete(ticketData.claimedBy).catch(() => null);
    }

    ticketData.claimedBy = null;
    ticketOwners.set(channelId, ticketData);
    scheduleSavePersistentState();

    if (ticketData.ticketMessageId) {
      await editTicketMessageButtons(ch, ticketData.ticketMessageId, null).catch(() => null);
    }

    // log do logi-ticket + backup wiadomości przed czyszczeniem
    try {
      const logCh = await getLogiTicketChannel(interaction.guild);
      // backup wiadomości przed usunięciem
      let backupAttachment = null;
      try {
        const messages = await ch.messages.fetch({ limit: 100 }).catch(() => null);
        if (messages && messages.size) {
          const sorted = Array.from(messages.values()).sort((a, b) => a.createdTimestamp - b.createdTimestamp);
          const lines = sorted.map((m) => {
            const ts = new Date(m.createdTimestamp).toISOString();
            const author = `${m.author.tag} (${m.author.id})`;
            const content = (m.content || "").replace(/\n/g, " ");
            const attachments = m.attachments?.size ? ` [załączniki: ${Array.from(m.attachments.values()).map((a) => a.url).join(", ")}]` : "";
            return `[${ts}] ${author}: ${content}${attachments}`;
          });
          const buf = Buffer.from(lines.join("\n"), "utf8");
          backupAttachment = new AttachmentBuilder(buf, { name: `ticket_${channelId}_history.txt` });
        }
      } catch (e) {
        console.error("Backup messages before unclaim failed:", e);
      }

      if (logCh) {
        const logEmbed = new EmbedBuilder()
          .setColor(COLOR_BLUE)
          .setDescription(`> \`🔓\` × Ticket zwolniony przez <@${interaction.user.id}>`)
          .setFooter({ text: `Kanał: ${ch.name}` })
          .setTimestamp();
        const payload = { embeds: [logEmbed] };
        if (backupAttachment) payload.files = [backupAttachment];
        await logCh.send(payload).catch(() => null);
      }
    } catch (e) {
      console.error("Log unclaim failed:", e);
    }

    // wyczyść historię kanału od czasu przejęcia do teraz (zostawiając samą wiadomość o przejęciu)
    try {
      let claimMsg = null;
      if (ticketData.lastClaimMsgId) {
        claimMsg = await ch.messages.fetch(ticketData.lastClaimMsgId).catch(() => null);
      }

      const msgs = await ch.messages.fetch({ limit: 100 }).catch(() => null);
      if (msgs && msgs.size) {
        const toDelete = msgs.filter((m) => {
          if (claimMsg && m.id === claimMsg.id) return false;
          if (m.id === interaction.message?.id) return false;
          if (claimMsg) return m.createdTimestamp >= claimMsg.createdTimestamp;
          return true;
        });
        if (toDelete.size) {
          await ch.bulkDelete(toDelete, true).catch(() => null);
        }
      }
    } catch (e) {
      console.error("Nie udało się wyczyścić historii kanału po odprzejęciu:", e);
    }

    const publicEmbed = new EmbedBuilder()
      .setColor(COLOR_BLUE)
      .setDescription(`> \`🔓\` × Ticket został zwolniony przez <@${interaction.user.id}>`);

    await ch.send({ embeds: [publicEmbed] }).catch(() => null);
    if (!isBtn) {
      await interaction.deleteReply().catch(() => null);
    }
  } catch (err) {
    console.error("Błąd przy unclaim:", err);
    await replyEphemeral("> \`❌\` Wystąpił błąd podczas odprzejmowania ticketu.");
  }
}

async function showSprzedazModal(interaction) {
  const modal = new ModalBuilder()
    .setCustomId("modal_sprzedaz")
    .setTitle("Informacje dot. zgłoszenia.");

  const coInput = new TextInputBuilder()
    .setCustomId("co_sprzedac")
    .setLabel("Co chcesz sprzedać?")
    .setPlaceholder("Przykład: 100k$")
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const serwerInput = new TextInputBuilder()
    .setCustomId("serwer")
    .setLabel("Na jakim serwerze?")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("Przykład: Anarchia")
    .setRequired(true);

  const ileInput = new TextInputBuilder()
    .setCustomId("ile")
    .setLabel("Ile oczekujesz?")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("Przykład: 20zł")
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder().addComponents(coInput),
    new ActionRowBuilder().addComponents(serwerInput),
    new ActionRowBuilder().addComponents(ileInput),
  );

  await interaction.showModal(modal);
}

async function showOdbiorModal(interaction) {
  const modal = new ModalBuilder()
    .setCustomId("modal_odbior")
    .setTitle("Nagroda za zaproszenia");

  const codeInput = new TextInputBuilder()
    .setCustomId("reward_code")
    .setLabel("Wpisz kod aby odberać nagrode!")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("Tutaj wpisz kod który otrzymałeś na pv")
    .setRequired(true)
    .setMaxLength(64);

  modal.addComponents(new ActionRowBuilder().addComponents(codeInput));

  await interaction.showModal(modal);
}

async function showInneModal(interaction) {
  const modal = new ModalBuilder()
    .setCustomId("modal_inne")
    .setTitle("Informacje dot. zgłoszenia.");

  const sprawaInput = new TextInputBuilder()
    .setCustomId("sprawa")
    .setLabel("W jakiej sprawie robisz ticketa?")
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(256)
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder().addComponents(sprawaInput));

  await interaction.showModal(modal);
}

async function handleModalSubmit(interaction) {
  const guildId = interaction.guildId;
  if (!guildId || !interaction.guild) return;

  const cid = interaction.customId || "";

  // quiz do przejęcia ticketu
  if (cid.startsWith("claim_quiz_")) {
    const data = pendingClaimQuiz.get(cid);
    if (!data || data.userId !== interaction.user.id) {
      await interaction.reply({ content: "> `❌` × Ta weryfikacja wygasła. Kliknij **Przejmij** ponownie.", flags: [MessageFlags.Ephemeral] }).catch(() => null);
      return;
    }
    const answer = (interaction.fields.getTextInputValue("claim_answer") || "").trim();
    if (answer !== data.answer) {
      await interaction.reply({ content: "> `❌` × Zła odpowiedź. Spróbuj ponownie.", flags: [MessageFlags.Ephemeral] }).catch(() => null);
      pendingClaimQuiz.delete(cid);
      return;
    }
    pendingClaimQuiz.delete(cid);
    await ticketClaimCommon(interaction, data.channelId, { skipQuiz: true });
    return;
  }

  // captcha do wlaczenia /autoprzejmij
  if (cid.startsWith("autoprzejmij_quiz_")) {
    const data = pendingAutoPrzejmijQuiz.get(cid);
    if (!data || data.userId !== interaction.user.id) {
      await interaction.reply({
        content: "> `❌` × Ta captcha wygasla. Uzyj /autoprzejmij ponownie.",
        flags: [MessageFlags.Ephemeral],
      }).catch(() => null);
      return;
    }

    const answer = (interaction.fields.getTextInputValue("autoprzejmij_answer") || "").trim();
    if (answer !== data.answer) {
      pendingAutoPrzejmijQuiz.delete(cid);
      await interaction.reply({
        content: "> `❌` × Zla odpowiedz captcha. Sprobuj ponownie.",
        flags: [MessageFlags.Ephemeral],
      }).catch(() => null);
      return;
    }

    pendingAutoPrzejmijQuiz.delete(cid);
    autoPrzejmijSettings.set(data.guildId, {
      enabled: true,
      ownerId: data.ownerId,
      ownerName: data.ownerName,
      enabledAt: Date.now(),
    });
    scheduleSavePersistentState();

    const stats = await runAutoPrzejmijSweep(
      interaction.guild,
      data.ownerId,
      data.ownerName,
      null,
    );

    await interaction.reply({
      content: formatAutoPrzejmijSummary(
        stats,
        "> `✅` × Autoprzejmowanie zostalo **wlaczone**.",
      ),
      flags: [MessageFlags.Ephemeral],
    }).catch(() => null);
    return;
  }

  const botName = client.user?.username || "NEWSHOP";

  // NEW: konkurs create modal
  if (interaction.customId === "konkurs_create_modal") {
    await handleKonkursCreateModal(interaction);
    return;
  }
  // KALKULATOR: ile otrzymam?
  if (interaction.customId === "modal_ile_otrzymam") {
    try {
      const kwotaStr = interaction.fields.getTextInputValue("kwota");
      const kwota = parseFloat(kwotaStr.replace(",", "."));

      if (isNaN(kwota) || kwota <= 0) {
        await interaction.reply({
          content: "> `❌` × Podaj **poprawną** kwotę w PLN.",
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }

      // Zapisz kwotę i pokaż menu z wyborem trybu i metody
      const userId = interaction.user.id;
      kalkulatorData.set(userId, { kwota, typ: "otrzymam" });

      const trybSelect = new StringSelectMenuBuilder()
        .setCustomId("kalkulator_tryb")
        .setPlaceholder("Wybierz serwer...")
        .addOptions(
          { label: "ANARCHIA LIFESTEAL", value: "ANARCHIA_LIFESTEAL", emoji: { id: "1469444521308852324", name: "ANARCHIA_GG" } },
          { label: "ANARCHIA BOXPVP", value: "ANARCHIA_BOXPVP", emoji: { id: "1469444521308852324", name: "ANARCHIA_GG" } },
          { label: "PYK MC", value: "PYK_MC", emoji: { id: "1457113144412475635", name: "PYK_MC" } }
        );

      const metodaSelect = new StringSelectMenuBuilder()
        .setCustomId("kalkulator_metoda")
        .setPlaceholder("Wybierz metodę płatności...")
        .addOptions(
          { label: "BLIK", value: "BLIK", description: "Szybki przelew BLIK (0% prowizji)", emoji: { id: "1469107179234525184", name: "BLIK" } },
          { label: "Kod BLIK", value: "Kod BLIK", description: "Kod BLIK (10% prowizji)", emoji: { id: "1469107179234525184", name: "BLIK" } },
          { label: "PSC", value: "PSC", description: "Paysafecard (10% prowizji)", emoji: { id: "1469107238676467940", name: "PSC" } },
          { label: "PSC bez paragonu", value: "PSC bez paragonu", description: "Paysafecard bez paragonu (20% prowizji)", emoji: { id: "1469107238676467940", name: "PSC" } },
          { label: "MYPSC", value: "MYPSC", description: "MYPSC (20% lub min 10zł)", emoji: { id: "1469107199350669473", name: "MYPSC" } },
          { label: "PayPal", value: "PayPal", description: "PayPal (5% prowizji)", emoji: { id: "1449354427755659444", name: "PAYPAL" } },
          { label: "LTC", value: "LTC", description: "Litecoin (5% prowizji)", emoji: { id: "1449186363101548677", name: "LTC" } }
        );

      const embed = new EmbedBuilder()
        .setColor(COLOR_BLUE)
        .setDescription(
          "```\n" +
          "🔢 New Shop × Obliczanie\n" +
          "```\n" +
          `> \`💵\` × **Wybrana kwota:** \`${kwota.toFixed(2)}zł\`\n> \`❗\` × Wybierz serwer i metodę płatności __poniżej:__`);

      await interaction.reply({
        embeds: [embed],
        components: [
          new ActionRowBuilder().addComponents(trybSelect),
          new ActionRowBuilder().addComponents(metodaSelect)
        ],
        flags: [MessageFlags.Ephemeral]
      });
    } catch (error) {
      console.error("Błąd w modal_ile_otrzymam:", error);
      await interaction.reply({
        content: "> `❌` × **Wystąpił** błąd podczas przetwarzania. Spróbuj **ponownie**.",
        flags: [MessageFlags.Ephemeral]
      });
    }
    return;
  }

  // KALKULATOR: ile muszę dać?
  if (interaction.customId === "modal_ile_musze_dac") {
    try {
      const walutaStr = interaction.fields.getTextInputValue("waluta");
      const waluta = parseShortNumber(walutaStr);

      if (!waluta || waluta <= 0 || waluta > 999_000_000) {
        await interaction.reply({
          content: "> `❌` × Podaj **poprawną** ilość waluty (1–999 000 000, możesz użyć k/m).",
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }

      // Zapisz walutę i pokaż menu z wyborem trybu i metody
      const userId = interaction.user.id;
      kalkulatorData.set(userId, { waluta, typ: "muszedac" });

      const trybSelect = new StringSelectMenuBuilder()
        .setCustomId("kalkulator_tryb")
        .setPlaceholder("Wybierz serwer...")
        .addOptions(
          { label: "ANARCHIA LIFESTEAL", value: "ANARCHIA_LIFESTEAL", emoji: { id: "1469444521308852324", name: "ANARCHIA_GG" } },
          { label: "ANARCHIA BOXPVP", value: "ANARCHIA_BOXPVP", emoji: { id: "1469444521308852324", name: "ANARCHIA_GG" } },
          { label: "PYK MC", value: "PYK_MC", emoji: { id: "1457113144412475635", name: "PYK_MC" } }
        );

      const metodaSelect = new StringSelectMenuBuilder()
        .setCustomId("kalkulator_metoda")
        .setPlaceholder("Wybierz metodę płatności...")
        .addOptions(
          { label: "BLIK", value: "BLIK", description: "Szybki przelew BLIK (0% prowizji)", emoji: { id: "1469107179234525184", name: "BLIK" } },
          { label: "Kod BLIK", value: "Kod BLIK", description: "Kod BLIK (10% prowizji)", emoji: { id: "1469107179234525184", name: "BLIK" } },
          { label: "PSC", value: "PSC", description: "Paysafecard (10% prowizji)", emoji: { id: "1469107238676467940", name: "PSC" } },
          { label: "PSC bez paragonu", value: "PSC bez paragonu", description: "Paysafecard bez paragonu (20% prowizji)", emoji: { id: "1469107238676467940", name: "PSC" } },
          { label: "MYPSC", value: "MYPSC", description: "MYPSC (20% lub min 10zł)", emoji: { id: "1469107199350669473", name: "MYPSC" } },
          { label: "PayPal", value: "PayPal", description: "PayPal (5% prowizji)", emoji: { id: "1449354427755659444", name: "PAYPAL" } },
          { label: "LTC", value: "LTC", description: "Litecoin (5% prowizji)", emoji: { id: "1449186363101548677", name: "LTC" } }
        );

      const embed = new EmbedBuilder()
        .setColor(COLOR_BLUE)
        .setDescription(
          "```\n" +
          "🔢 New Shop × Obliczanie\n" +
          "```\n" +
          `> \`💲\` × **Wybrana ilość waluty:** \`${formatShortWaluta(waluta)}\`\n> \`❗\` × Wybierz serwer i metodę płatności __poniżej:__`);

      await interaction.reply({
        embeds: [embed],
        components: [
          new ActionRowBuilder().addComponents(trybSelect),
          new ActionRowBuilder().addComponents(metodaSelect)
        ],
        flags: [MessageFlags.Ephemeral]
      });
    } catch (error) {
      console.error("Błąd w modal_ile_musze_dac:", error);
      await interaction.reply({
        content: "> \`❌\` **Wystąpił błąd podczas przetwarzania. Spróbuj ponownie.**",
        flags: [MessageFlags.Ephemeral]
      });
    }
    return;
  }

  // NEW: konkurs join modal
  if (interaction.customId.startsWith("konkurs_join_modal_")) {
    const msgId = interaction.customId.replace("konkurs_join_modal_", "");
    await handleKonkursJoinModal(interaction, msgId);
    return;
  }

  // NEW: verification modal handling
  if (interaction.customId.startsWith("modal_verify_")) {
    const modalId = interaction.customId;
    const record = pendingVerifications.get(modalId);

    if (!record) {
      await interaction.reply({
        content:
          "> \`❌\` **Nie mogę znaleźć zapisanego zadania weryfikacji (spróbuj ponownie).**",
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    if (record.userId !== interaction.user.id) {
      await interaction.reply({
        content:
          "> \`❌\` **Tylko użytkownik, który kliknął przycisk, może rozwiązać tę zagadkę.**",
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    const entered = interaction.fields
      .getTextInputValue("verify_answer")
      .trim();
    const numeric = parseInt(entered.replace(/[^0-9\-]/g, ""), 10);

    if (Number.isNaN(numeric)) {
      await interaction.reply({
        content: "\`❌\` **Nieprawidłowa odpowiedź (powinna być liczbą).**",
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    if (numeric !== record.answer) {
      await interaction.reply({
        content: "> \`❌\` × **Źle! Nieprawidłowy wynik. Spróbuj jeszcze raz.**",
        flags: [MessageFlags.Ephemeral],
      });
      // remove record so they can request a new puzzle
      pendingVerifications.delete(modalId);
      return;
    }

    // correct answer
    pendingVerifications.delete(modalId);

    let roleId = record.roleId;
    const guild = interaction.guild;

    // if no roleId recorded, try to find dynamically in guild and cache it
    if (!roleId && guild) {
      const normalize = (s = "") =>
        s
          .toString()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-z0-9 ]/gi, "")
          .trim()
          .toLowerCase();

      let role =
        guild.roles.cache.find(
          (r) => r.name === DEFAULT_NAMES.verificationRoleName,
        ) ||
        guild.roles.cache.find((r) =>
          normalize(r.name).includes(normalize("klient")),
        );

      if (role) {
        roleId = role.id;
        verificationRoles.set(guild.id, roleId);
        scheduleSavePersistentState();
        console.log(
          `Dynamicznie ustawiono rolę weryfikacji dla guild ${guild.id}: ${role.name} (${roleId})`,
        );
      } else {
        console.log(
          `Nie znaleziono roli weryfikacji w guild ${guild.id} podczas nadawania roli.`,
        );
      }
    }

    if (!roleId) {
      await interaction.reply({
        content:
          "✅ Poprawnie! Niestety rola weryfikacji nie została znaleziona. Skontaktuj się z administracją.",
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    try {
      // give role
      const member = await guild.members.fetch(interaction.user.id);
      await member.roles.add(roleId, "Przejście weryfikacji");

      // prepare DM embed (as requested)
      const dmEmbed = new EmbedBuilder()
        .setColor(COLOR_BLUE)
        .setDescription(
          "```\n" +
          "🛒 New Shop × WERYFIKACJA\n" +
          "```\n" +
          "`✨` Gratulacje!\n\n" +
          "`📝` Pomyślnie przeszedłeś weryfikacje na naszym serwerze discord życzymy udanych zakupów!",
        )
        .setTimestamp();

      // send DM to user
      try {
        await interaction.user.send({ embeds: [dmEmbed] });
        // ephemeral confirmation (not public)
        await interaction.reply({
          content: "> \`✅\` × Zostałeś pomyślnie zweryfikowany",
          flags: [MessageFlags.Ephemeral],
        });
      } catch (dmError) {
        console.error("Nie udało się wysłać DM po weryfikacji:", dmError);
        await interaction.reply({
          content: "> \`✅\` × Zostałeś pomyślnie zweryfikowany",
          flags: [MessageFlags.Ephemeral],
        });
      }

      console.log(
        `Użytkownik ${interaction.user.username} przeszedł weryfikację na serwerze ${guild.id}`,
      );
    } catch (error) {
      console.error("Błąd przy nadawaniu roli po weryfikacji:", error);
      await interaction.reply({
        content: "> \`❌\` **Wystąpił błąd przy nadawaniu roli.**",
        flags: [MessageFlags.Ephemeral],
      });
    }
    return;
  }

  // redeem code modal handling (used in tickets)
  if (interaction.customId.startsWith("modal_redeem_code_")) {
    const enteredCode = interaction.fields
      .getTextInputValue("discount_code")
      .toUpperCase();
    const codeData = activeCodes.get(enteredCode);

    if (!codeData) {
      await interaction.reply({
        content:
          "❌ **Nieprawidłowy kod!**",
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    // Sprawdź typ kodu
    if (codeData.type === "invite_cash" || codeData.type === "invite_reward") {
      await interaction.reply({
        content:
          "❌ Kod na 50k$ można wpisać jedynie klikając kategorię 'Nagroda za zaproszenia' w TicketPanel i wpisując tam kod!",
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    if (codeData.used) {
      await interaction.reply({
        content: "> `❌` × **Kod** został już wykorzystany!",
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    if (Date.now() > codeData.expiresAt) {
      activeCodes.delete(enteredCode);
      await db.deleteActiveCode(enteredCode);
      scheduleSavePersistentState();
      await interaction.reply({
        content: "> `❌` × **Kod** wygasł!",
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    codeData.used = true;
    activeCodes.delete(enteredCode);
    await db.deleteActiveCode(enteredCode);
    
    // Aktualizuj w Supabase
    await db.updateActiveCode(enteredCode, { used: true });
    
    scheduleSavePersistentState();

    const redeemEmbed = new EmbedBuilder()
      .setColor(0xd4af37)
      .setTitle("\`📉\` WYKORZYSTAŁEŚ KOD RABATOWY")
      .setDescription(
        "```\n" +
        enteredCode +
        "\n```\n" +
        `> \`💸\` × **Otrzymałeś:** \`-${codeData.discount}%\`\n`,
      )
      .setTimestamp();

    await interaction.reply({ embeds: [redeemEmbed] });
    console.log(
      `Użytkownik ${interaction.user.username} odebrał kod rabatowy ${enteredCode} (-${codeData.discount}%)`,
    );
    return;
  }

  // Ticket settings modals: rename/add/remove
  if (interaction.customId.startsWith("modal_rename_")) {
    const chId = interaction.customId.replace("modal_rename_", "");
    const newName = interaction.fields
      .getTextInputValue("new_ticket_name")
      .trim();
    const channel = await interaction.guild.channels
      .fetch(chId)
      .catch(() => null);
    if (!channel) {
      await interaction.reply({
        content: "> `❌` × **Błąd** z próbą odnalezienia **kanału**.",
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }
    const data = ticketOwners.get(chId) || {
      claimedBy: null,
      ticketMessageId: null,
    };
    const claimer = data.claimedBy;

    if (!isAdminOrSeller(interaction.member)) {
      await interaction.reply({
        content: "> `❗` × Brak wymaganych uprawnień.",
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }
    if (
      claimer &&
      claimer !== interaction.user.id &&
      !isAdminOrSeller(interaction.member)
    ) {
      await interaction.reply({
        content: "> `❗` × Brak wymaganych uprawnień.",
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }
    try {
      await channel.setName(newName);

      // prepare DM embed (as requested)
      // send DM to user

      await interaction.reply({
        content: `✅ Zmieniono nazwę ticketu na \`${newName}\`.`,
        flags: [MessageFlags.Ephemeral],
      });
    } catch (err) {
      console.error("Błąd zmiany nazwy ticketu:", err);
      await interaction.reply({
        content: "> `❌` × **Nie udało się** zmienić nazwy **ticketu**.",
        flags: [MessageFlags.Ephemeral],
      });
    }
    return;
  }

  if (interaction.customId.startsWith("modal_add_")) {
    const chId = interaction.customId.replace("modal_add_", "");
    const userInput = interaction.fields
      .getTextInputValue("user_to_add")
      .trim();
    const channel = await interaction.guild.channels
      .fetch(chId)
      .catch(() => null);
    if (!channel) {
      await interaction.reply({
        content: "> `❌` × **Kanał** nie znaleziony.",
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }
    const data = ticketOwners.get(chId) || { claimedBy: null };
    const claimer = data.claimedBy;

    if (!isAdminOrSeller(interaction.member)) {
      await interaction.reply({
        content: "> `❗` × Brak wymaganych uprawnień.",
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }
    if (
      claimer &&
      claimer !== interaction.user.id &&
      !isAdminOrSeller(interaction.member)
    ) {
      await interaction.reply({
        content: "> `❗` × Brak wymaganych uprawnień.",
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    // parse mention or id
    const match =
      userInput.match(/<@!?(\d+)>/) || userInput.match(/(\d{17,20})/);
    if (!match) {
      await interaction.reply({
        content: "> `❌` × **Nieprawidłowy** format użytkownika. Podaj **@mention** lub **ID**.",
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }
    const userIdToAdd = match[1];
    try {
      await channel.permissionOverwrites.edit(userIdToAdd, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true,
      });
      await interaction.reply({
        content: `✅ Dodano <@${userIdToAdd}> do ticketu.`,
        flags: [MessageFlags.Ephemeral],
      });
    } catch (err) {
      console.error("Błąd dodawania użytkownika do ticketu:", err);
      await interaction.reply({
        content: "> `❌` × **Nie udało się** dodać użytkownika (sprawdź uprawnienia).",
        flags: [MessageFlags.Ephemeral],
      });
    }
    return;
  }

  if (interaction.customId.startsWith("modal_remove_")) {
    const chId = interaction.customId.replace("modal_remove_", "");
    const userInput = interaction.fields
      .getTextInputValue("user_to_remove")
      .trim();
    const channel = await interaction.guild.channels
      .fetch(chId)
      .catch(() => null);
    if (!channel) {
      await interaction.reply({
        content: "> `❌` × **Kanał** nie znaleziony.",
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }
    const data = ticketOwners.get(chId) || { claimedBy: null };
    const claimer = data.claimedBy;

    if (!isAdminOrSeller(interaction.member)) {
      await interaction.reply({
        content: "> `❗` × Brak wymaganych uprawnień.",
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }
    if (
      claimer &&
      claimer !== interaction.user.id &&
      !isAdminOrSeller(interaction.member)
    ) {
      await interaction.reply({
        content: "> `❗` × Brak wymaganych uprawnień.",
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    const match =
      userInput.match(/<@!?(\d+)>/) || userInput.match(/(\d{17,20})/);
    if (!match) {
      await interaction.reply({
        content: "> `❌` × **Nieprawidłowy** format użytkownika. Podaj **@mention** lub **ID**.",
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }
    const userIdToRemove = match[1];
    try {
      await channel.permissionOverwrites
        .delete(userIdToRemove)
        .catch(() => null);
      await interaction.reply({
        content: `✅ Usunięto <@${userIdToRemove}> z ticketu.`,
        flags: [MessageFlags.Ephemeral],
      });
    } catch (err) {
      console.error("Błąd usuwania użytkownika z ticketu:", err);
      await interaction.reply({
        content: "> `❌` × **Nie udało się** usunąć użytkownika (sprawdź uprawnienia).",
        flags: [MessageFlags.Ephemeral],
      });
    }
    return;
  }

  // Ticket modal flows follow...
  const ticketNumber = getNextTicketNumber(guildId);
  const categories = ticketCategories.get(guildId) || {};
  const user = interaction.user;

  let categoryId;
  let ticketType;
  let ticketTypeLabel;
  let formInfo;
  let ticketTopic;
  let forceOwnerOnlyVisibility = false;

  switch (interaction.customId) {
    case "modal_zakup": {
      const serwer = interaction.fields.getTextInputValue("serwer");
      const kwotaRaw = interaction.fields.getTextInputValue("kwota");
      const platnosc = interaction.fields.getTextInputValue("platnosc");
      const oczekiwanaWaluta = interaction.fields.getTextInputValue(
        "oczekiwana_waluta",
      );

      const lettersOnly = /^[A-Za-zĄąĆćĘęŁłŃńÓóŚśŹźŻż\s-]+$/;
      if (!lettersOnly.test(serwer)) {
        await interaction.reply({
          content: "> `❌` × Wpisz nazwę serwera literami (bez cyfr).",
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }
      let kwotaNum = parseFloat(kwotaRaw.replace(/,/g, '.'));
      if (Number.isNaN(kwotaNum)) {
        await interaction.reply({
          content: "> `❌` × Podaj kwotę jako liczbę, np. `20` lub `20.5` (zł).",
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }
      if (!lettersOnly.test(platnosc)) {
        await interaction.reply({
          content: "> `❌` × Napisz metodę płatności literami, bez cyfr.",
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }

      // Użyj już sparsowanej kwoty (kwotaNum) – zapewnia liczbową wartość
      if (!Number.isFinite(kwotaNum) || kwotaNum < 0) kwotaNum = 0;

      // routing to categories: treat >100 as 100-200+ (user requested)
      if (kwotaNum <= 20) {
        categoryId = categories["zakup-0-20"];
        ticketType = "zakup-0-20";
      } else if (kwotaNum <= 50) {
        categoryId = categories["zakup-20-50"];
        ticketType = "zakup-20-50";
      } else if (kwotaNum <= 100) {
        categoryId = categories["zakup-50-100"];
        ticketType = "zakup-50-100";
      } else {
        // anything above 100 goes to 100-200+ category
        categoryId = categories["zakup-100-200"];
        ticketType = "zakup-100-200";
      }

      ticketTypeLabel = "ZAKUP";
      // Prosty opis bez kalkulacji
      ticketTopic = `Zakup na serwerze: ${serwer}`;
      if (ticketTopic.length > 1024) ticketTopic = ticketTopic.slice(0, 1024);

      if (kwotaNum < 5) {
        await interaction.reply({
          content: "> `❌` × Minimalna kwota zakupu to **5zł**.",
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }

      formInfo = `> <a:arrowwhite:1469100658606211233> × **Serwer:** \`${serwer}\`\n` +
        `> <a:arrowwhite:1469100658606211233> × **Kwota:** \`${kwotaNum}zł\`\n` +
        `> <a:arrowwhite:1469100658606211233> × **Metoda płatności:** \`${platnosc}\`\n` +
        `> <a:arrowwhite:1469100658606211233> × **Chciałby zakupić:** \`${oczekiwanaWaluta}\``;
      break;
    }
    case "modal_mody_zakup": {
      const modName = (interaction.fields.getTextInputValue("mod_name") || "").trim();
      const paymentMethod = (interaction.fields.getTextInputValue("payment_method") || "").trim();
      const modsCountRaw = (interaction.fields.getTextInputValue("mods_count") || "").trim();

      if (!modName) {
        await interaction.reply({
          content: "> `❌` × Podaj nazwę moda, którego chcesz kupić.",
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }

      if (!paymentMethod) {
        await interaction.reply({
          content: "> `❌` × Podaj metodę płatności.",
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }

      if (!/^\d+$/.test(modsCountRaw)) {
        await interaction.reply({
          content: "> `❌` × Liczba modów musi być liczbą od **1** do **4**.",
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }

      const modsCount = parseInt(modsCountRaw, 10);
      if (modsCount < 1 || modsCount > 4) {
        await interaction.reply({
          content: "> `❌` × Możesz kupić jednorazowo od **1** do **4** modów.",
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }

      const totalPrice = modsCount * 20;
      if (totalPrice <= 20) {
        categoryId = categories["zakup-0-20"];
        ticketType = "zakup-0-20";
      } else if (totalPrice <= 50) {
        categoryId = categories["zakup-20-50"];
        ticketType = "zakup-20-50";
      } else if (totalPrice <= 100) {
        categoryId = categories["zakup-50-100"];
        ticketType = "zakup-50-100";
      } else {
        categoryId = categories["zakup-100-200"];
        ticketType = "zakup-100-200";
      }

      ticketTypeLabel = "ZAKUP";
      ticketTopic = `Zakup moda: ${modName} (${modsCount} szt.)`;
      if (ticketTopic.length > 1024) ticketTopic = ticketTopic.slice(0, 1024);
      forceOwnerOnlyVisibility = true;

      formInfo = `> <a:arrowwhite:1469100658606211233> × **Mod:** \`${modName}\`\n` +
        `> <a:arrowwhite:1469100658606211233> × **Metoda płatności:** \`${paymentMethod}\`\n` +
        `> <a:arrowwhite:1469100658606211233> × **Ilość modów:** \`${modsCount}\`\n` +
        `> <a:arrowwhite:1469100658606211233> × **Łączna kwota:** \`${totalPrice}zł\``;
      break;
    }
    case "modal_sprzedaz": {
      const co = interaction.fields.getTextInputValue("co_sprzedac");
      const serwer = interaction.fields.getTextInputValue("serwer");
      const ile = interaction.fields.getTextInputValue("ile");
      const kwotaSprzedaz = parseFloat(ile.replace(/,/g, '.'));
      const lettersOnly = /^[A-Za-zĄąĆćĘęŁłŃńÓóŚśŹźŻż\s-]+$/;
      if (!lettersOnly.test(serwer)) {
        await interaction.reply({
          content: "> `❌` × Wpisz nazwę serwera literami (bez cyfr).",
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }
      if (!Number.isNaN(kwotaSprzedaz) && kwotaSprzedaz < 10) {
        await interaction.reply({
          content: "> `❌` × Minimalna kwota sprzedaży to **10zł**.",
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }
      if (Number.isNaN(kwotaSprzedaz)) {
        await interaction.reply({
          content: "> `❌` × Podaj kwotę jako liczbę, np. `25` lub `25.5` (zł).",
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }

      categoryId = categories["sprzedaz"];
      ticketType = "sprzedaz";
      ticketTypeLabel = "SPRZEDAŻ";
      if (!Number.isNaN(kwotaSprzedaz) && kwotaSprzedaz < 10) {
        await interaction.reply({
          content: "> `❌` × Minimalna kwota sprzedaży to **10zł**.",
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }

      formInfo = `> <a:arrowwhite:1469100658606211233> × **Co chce sprzedać:** \`${co}\`\n> <a:arrowwhite:1469100658606211233> × **Serwer:** \`${serwer}\`\n> <a:arrowwhite:1469100658606211233> × **Oczekiwana kwota:** \`${ile}\``;
      break;
    }
    case "modal_odbior": {
      const enteredCodeRaw =
        interaction.fields.getTextInputValue("reward_code") || "";
      const enteredCode = enteredCodeRaw.trim().toUpperCase();

      if (!enteredCode) {
        await interaction.reply({
          content: "> `❌` × **Nie podałeś** kodu.",
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }

      const codeData = activeCodes.get(enteredCode);

      if (!codeData) {
        await interaction.reply({
          content:
            "> \`❌\` **Nieprawidłowy kod!**",
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }

      // Sprawdź czy to kod na nagrodę
      if (
        codeData.type !== "invite_cash" &&
        codeData.type !== "invite_reward"
      ) {
        await interaction.reply({
          content:
            "❌ Ten kod nie jest kodem nagrody za zaproszenia. Użyj go w odpowiedniej kategorii.",
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }

      if (codeData.used) {
        await interaction.reply({
          content: "> `❌` × **Ten kod** został już użyty.",
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }

      if (Date.now() > (codeData.expiresAt || 0)) {
        activeCodes.delete(enteredCode);
        scheduleSavePersistentState();
        await interaction.reply({
          content: "> `❌` × **Ten kod** wygasł.",
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }

      // Sprawdź czy kod należy do użytkownika
      if (String(codeData.oderId) !== String(interaction.user.id)) {
        await interaction.reply({
          content:
            "❌ Ten kod nie należy do Ciebie — zrealizować może tylko właściciel kodu (ten, który otrzymał go w DM).",
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }

      // Oznacz kod jako użyty
      codeData.used = true;
      activeCodes.delete(enteredCode);
      await db.deleteActiveCode(enteredCode);
      scheduleSavePersistentState();

      // Stwórz ticket typu ODBIÓR NAGRODY
      const ticketNumber = getNextTicketNumber(interaction.guildId);
      const categories = ticketCategories.get(interaction.guildId) || {};
      const user = interaction.user;

      const categoryId = REWARDS_CATEGORY_ID;
      const ticketTypeLabel = "NAGRODA ZA ZAPROSZENIA";

      const expiryTs = codeData.expiresAt
        ? Math.floor(codeData.expiresAt / 1000)
        : null;
      const expiryLine = expiryTs
        ? `\n> <a:arrowwhite:1469100658606211233> × **Kod wygasa za:** <t:${expiryTs}:R>`
        : "";

      const formInfo = `> <a:arrowwhite:1469100658606211233> × **Kod:** \`${enteredCode}\`\n> <a:arrowwhite:1469100658606211233> × **Nagroda:** \`${codeData.rewardText || INVITE_REWARD_TEXT || "50k$"}\`${expiryLine}`;

      try {
        let parentToUse = categoryId;
        if (!parentToUse) {
          const foundCat = interaction.guild.channels.cache.find(
            (c) =>
              c.type === ChannelType.GuildCategory &&
              c.name &&
              c.name.toLowerCase().includes("odbior"),
          );
          if (foundCat) parentToUse = foundCat.id;
        }

        const createOptions = {
          name: `ticket-${user.username}`,
          type: ChannelType.GuildText,
          permissionOverwrites: [
            {
              id: interaction.guild.id,
              deny: [PermissionsBitField.Flags.ViewChannel],
            },
            {
              id: user.id,
              allow: [
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.SendMessages,
                PermissionsBitField.Flags.ReadMessageHistory,
              ],
            },
          ],
        };
        if (parentToUse) createOptions.parent = parentToUse;

        // Specjalna obsługa dla kategorii "inne" - dodaj uprawnienia dla właściciela
        if (parentToUse && parentToUse === categories["inne"]) {
          createOptions.permissionOverwrites.push(
            { id: interaction.guild.ownerId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] } // właściciel serwera
          );
        }

        const channel = await interaction.guild.channels.create(createOptions);

    const embed = new EmbedBuilder()
      .setColor(COLOR_BLUE) // Discord blurple (#5865F2)
      .setDescription(
        `## \`🛒 NEW SHOP × ${ticketTypeLabel}\`\n\n` +
            `### ・ \`👤\` × Informacje o kliencie:\n` +
            `> <a:arrowwhite:1469100658606211233> × **Ping:** <@${user.id}>\n` +
            `> <a:arrowwhite:1469100658606211233> × **Nick:** \`${interaction.member?.displayName || user.globalName || user.username}\`\n` +
            `> <a:arrowwhite:1469100658606211233> × **ID:** \`${user.id}\`\n` +
            `### ・ \`📋\` × Informacje z formularza:\n` +
            `${formInfo}`,
          )
          .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 128 }))
          .setTimestamp();

        const closeButton = new ButtonBuilder()
          .setCustomId(`ticket_close_${channel.id}`)
          .setLabel("Zamknij")
          .setStyle(ButtonStyle.Secondary);
        const settingsButton = new ButtonBuilder()
          .setCustomId(`ticket_settings_${channel.id}`)
          .setLabel("Ustawienia")
          .setStyle(ButtonStyle.Secondary);
        const claimButton = new ButtonBuilder()
          .setCustomId(`ticket_claim_${channel.id}`)
          .setLabel("Przejmij")
          .setStyle(ticketTypeLabel === "NAGRODA ZA ZAPROSZENIA" ? ButtonStyle.Secondary : ButtonStyle.Primary);
        const unclaimButton = new ButtonBuilder()
          .setCustomId(`ticket_unclaim_${channel.id}`)
          .setLabel("Odprzejmij")
          .setStyle(ticketTypeLabel === "NAGRODA ZA ZAPROSZENIA" ? ButtonStyle.Secondary : ButtonStyle.Danger)
          .setDisabled(true);

        const buttonRow = new ActionRowBuilder().addComponents(
          closeButton,
          settingsButton,
          claimButton,
          unclaimButton,
        );

        const sentMsg = await channel.send({
          content: `@everyone`,
          embeds: [embed],
          components: [buttonRow],
        });

        ticketOwners.set(channel.id, {
          claimedBy: null,
          userId: user.id,
          ticketMessageId: sentMsg.id,
          locked: false,
        });
        scheduleSavePersistentState();

        await logTicketCreation(interaction.guild, channel, {
          openerId: user.id,
          ticketTypeLabel,
          formInfo,
          ticketChannelId: channel.id,
          ticketMessageId: sentMsg.id,
        }).catch(() => { });

        await interaction.reply({
          content: `> \`✅\` × Ticket został stworzony <#${channel.id}>.`,
          flags: [MessageFlags.Ephemeral],
        });
      } catch (err) {
        console.error("Błąd tworzenia ticketu (odbior):", err);
        await interaction.reply({
          content: "> `❌` × **Wystąpił** błąd podczas tworzenia **ticketa**.",
          flags: [MessageFlags.Ephemeral],
        });
      }
      break;
    }
    case "modal_konkurs_odbior": {
      const info = interaction.fields.getTextInputValue("konkurs_info");

      categoryId = REWARDS_CATEGORY_ID;
      ticketType = "konkurs-nagrody";
      ticketTypeLabel = "NAGRODA ZA KONKURS";
      formInfo = `> <a:arrowwhite:1469100658606211233> × **Informacje:** \`${info}\``;
      break;
    }
    case "modal_inne": {
      const sprawa = interaction.fields.getTextInputValue("sprawa");

      categoryId = categories["inne"];
      ticketType = "inne";
      ticketTypeLabel = "INNE";
      formInfo = `> <a:arrowwhite:1469100658606211233> × **Sprawa:** \`${sprawa}\``;
      break;
    }
    default:
      break;
  }

  // If ticketType not set it was probably a settings modal handled above or unknown
  if (!ticketType) return;

  try {
    // ENFORCE: One ticket per user
    // Search ticketOwners for existing open ticket owned by this user
    for (const [chanId, tData] of ticketOwners.entries()) {
      if (tData && tData.userId === user.id) {
        // ensure channel still exists
        const existingChannel = await interaction.guild.channels
          .fetch(chanId)
          .catch(() => null);
        if (existingChannel) {
          await interaction.reply({
            content: `❌ Masz już otwarty ticket: <#${chanId}> — zamknij go zanim otworzysz nowy.`,
            flags: [MessageFlags.Ephemeral],
          });
          return;
        } else {
          // stale entry — remove it
          ticketOwners.delete(chanId);
          scheduleSavePersistentState();
        }
      }
    }

    // find a fallback category when categoryId undefined — attempt some heuristics
    let parentToUse = null;
    if (categoryId) {
      parentToUse = categoryId;
    } else {
      // heuristics based on ticketType
      const preferNames = {
        "zakup-0-20": "zakup",
        "zakup-20-50": "zakup",
        "zakup-50-100": "zakup",
        "zakup-100-200": "zakup",
        sprzedaz: "sprzedaz",
        "odbior-nagrody": "odbior",
        inne: "inne",
      };
      const prefer = preferNames[ticketType] || ticketType;
      const foundCat = interaction.guild.channels.cache.find(
        (c) =>
          c.type === ChannelType.GuildCategory &&
          c.name &&
          c.name.toLowerCase().includes(prefer),
      );
      if (foundCat) parentToUse = foundCat.id;
      else parentToUse = null;
    }

    // create channel with or without parent
    const createOptions = {
      name: `ticket-${user.username}`,
      type: ChannelType.GuildText,
      permissionOverwrites: [
        {
          id: interaction.guild.id,
          deny: [PermissionsBitField.Flags.ViewChannel], // @everyone nie widzi ticketów
        },
        {
          id: interaction.user.id,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory,
          ],
        },
      ],
    };

    if (
      forceOwnerOnlyVisibility &&
      interaction.guild.ownerId &&
      interaction.guild.ownerId !== interaction.user.id
    ) {
      createOptions.permissionOverwrites.push({
        id: interaction.guild.ownerId,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
        ],
      });
    }

    // Dodaj rangi limitów w zależności od kategorii
    if (parentToUse && !forceOwnerOnlyVisibility) {
      const categoryId = parentToUse;
      
      // Zakup 0-20 - wszystkie rangi widzą
      if (categoryId === "1449526840942268526") {
        createOptions.permissionOverwrites.push(
          { id: "1449448705563557918", allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }, // limit 20
          { id: "1449448702925209651", allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }, // limit 50
          { id: "1449448686156255333", allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }, // limit 100
          { id: "1449448860517798061", allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }  // limit 200
        );
      }
      // Zakup 20-50 - limit 20 nie widzi
      else if (categoryId === "1449526958508474409") {
        createOptions.permissionOverwrites.push(
          { id: "1449448702925209651", allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }, // limit 50
          { id: "1449448686156255333", allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }, // limit 100
          { id: "1449448860517798061", allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }  // limit 200
        );
      }
      // Zakup 50-100 - limit 20 i 50 nie widzą
      else if (categoryId === "1449451716129984595") {
        createOptions.permissionOverwrites.push(
          { id: "1449448686156255333", allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }, // limit 100
          { id: "1449448860517798061", allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }  // limit 200
        );
      }
      // Zakup 100-200 - tylko limit 200 widzi
      else if (categoryId === "1449452354201190485") {
        createOptions.permissionOverwrites.push(
          { id: "1449448860517798061", allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }  // limit 200
        );
      }
      // Sprzedaż - wszystkie rangi widzą
      else if (categoryId === "1449455848043708426") {
        createOptions.permissionOverwrites.push(
          { id: "1449448705563557918", allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }, // limit 20
          { id: "1449448702925209651", allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }, // limit 50
          { id: "1449448686156255333", allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }, // limit 100
          { id: "1449448860517798061", allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }  // limit 200
        );
      }
      // Inne - tylko właściciel serwera widzi (oprócz właściciela ticketu)
      else if (categoryId === "1449527585271976131") {
        createOptions.permissionOverwrites.push(
          { id: interaction.guild.ownerId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] } // właściciel serwera
        );
      }
    }
    if (ticketTopic) createOptions.topic = ticketTopic;
    if (parentToUse) createOptions.parent = parentToUse;

    const channel = await interaction.guild.channels.create(createOptions);
    if (forceOwnerOnlyVisibility) {
      await channel.permissionOverwrites
        .set(createOptions.permissionOverwrites)
        .catch(() => null);
    }

    const embed = new EmbedBuilder()
      .setColor(COLOR_BLUE) // Discord blurple (#5865F2)
      .setDescription(
        `## \`🛒 NEW SHOP × ${ticketTypeLabel}\`\n\n` +
        `### ・ \`👤\` × Informacje o kliencie:\n` +
        `> <a:arrowwhite:1469100658606211233> × **Ping:** <@${user.id}>\n` +
        `> <a:arrowwhite:1469100658606211233> × **Nick:** \`${interaction.member?.displayName || user.globalName || user.username}\`\n` +
        `> <a:arrowwhite:1469100658606211233> × **ID:** \`${user.id}\`\n` +
        `### ・ \`📋\` × Informacje z formularza:\n` +
        `${formInfo}`,
      )
      .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 128 })) // avatar user po prawej
      .setTimestamp();

    // Build buttons: Close (disabled for non-admin in interaction), Settings, Code (if zakup), Claim + Unclaim (disabled)
    const closeButton = new ButtonBuilder()
      .setCustomId(`ticket_close_${channel.id}`)
      .setLabel("Zamknij")
      .setStyle(ButtonStyle.Secondary);

    const settingsButton = new ButtonBuilder()
      .setCustomId(`ticket_settings_${channel.id}`)
      .setLabel("Ustawienia")
      .setStyle(ButtonStyle.Secondary);

    const buttons = [closeButton, settingsButton];

    if (ticketTypeLabel === "ZAKUP") {
      buttons.push(
        new ButtonBuilder()
          .setCustomId(`ticket_code_${channel.id}_${user.id}`)
          .setLabel("Kod rabatowy")
          .setStyle(ButtonStyle.Secondary),
      );
    }

    const claimButton = new ButtonBuilder()
      .setCustomId(`ticket_claim_${channel.id}`)
      .setLabel("Przejmij")
      .setStyle(ticketTypeLabel === "NAGRODA ZA ZAPROSZENIA" ? ButtonStyle.Secondary : ButtonStyle.Secondary);

    const unclaimButton = new ButtonBuilder()
      .setCustomId(`ticket_unclaim_${channel.id}`)
      .setLabel("Odprzejmij")
      .setStyle(ticketTypeLabel === "NAGRODA ZA ZAPROSZENIA" ? ButtonStyle.Secondary : ButtonStyle.Secondary)
      .setDisabled(true);

    buttons.push(claimButton, unclaimButton);

    const buttonRow = new ActionRowBuilder().addComponents(...buttons);

    // send message and capture it (so we can edit buttons later)
    const sentMsg = await channel.send({
      content: `@everyone`,
      embeds: [embed],
      components: [buttonRow],
    });

    ticketOwners.set(channel.id, {
      claimedBy: null,
      userId: user.id,
      ticketMessageId: sentMsg.id,
      locked: false,
    });
    scheduleSavePersistentState();

    // LOG: ticket creation in logi-ticket channel (if exists)
    try {
      await logTicketCreation(interaction.guild, channel, {
        openerId: user.id,
        ticketTypeLabel,
        formInfo,
        ticketChannelId: channel.id,
        ticketMessageId: sentMsg.id,
      }).catch((e) => console.error("logTicketCreation error:", e));
    } catch (e) {
      console.error("Błąd logowania utworzenia ticketu:", e);
    }

    await interaction.reply({
      content: `> \`✅\` × Ticket został stworzony <#${channel.id}>`,
      flags: [MessageFlags.Ephemeral],
    });

    if (ticketTypeLabel === "ZAKUP") {
      await maybeAutoPrzejmijNewTicket(interaction.guild, channel.id).catch((err) =>
        console.error("[autoprzejmij] Auto-claim po utworzeniu ticketa nieudany:", err),
      );
    }
  } catch (error) {
    console.error("Błąd tworzenia ticketu:", error);
    await interaction.reply({
      content: "> `❌` × **Wystąpił** błąd podczas tworzenia **ticketu**.",
      flags: [MessageFlags.Ephemeral],
    });
  }
}

// message create handler: enforce channel restrictions and keep existing legitcheck behavior
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

  // ANTI-DISCORD-INVITE: delete invite links and timeout user for 30 minutes
  try {
    const content = message.content || "";
    const inviteRegex =
      /(https?:\/\/)?(www\.)?(discord\.gg|discord(?:app)?\.com\/invite)\/[^\s/]+/i;
    if (inviteRegex.test(content)) {
      // delete message first
      try {
        await message.delete().catch(() => null);
      } catch (e) {
        // ignore
      }
      // attempt to timeout the member for 30 minutes (1800 seconds = 30 minutes)
      try {
        const member = message.member;
        if (member && typeof member.timeout === "function") {
          const ms = 30 * 60 * 1000;
          await member
            .timeout(ms, "Wysłanie linku Discord invite/discord.gg")
            .catch(() => null);
        } else if (member && member.manageable) {
          // fallback: try to add a muted role named 'Muted' (best-effort)
          const guild = message.guild;
          let mutedRole = guild.roles.cache.find(
            (r) => r.name.toLowerCase() === "muted",
          );
          if (!mutedRole) {
            try {
              mutedRole = await guild.roles
                .create({ name: "Muted", permissions: [] })
                .catch(() => null);
            } catch (e) {
              mutedRole = null;
            }
          }
          if (mutedRole) {
            await member.roles.add(mutedRole).catch(() => null);
            // schedule removal in 30 minutes
            setTimeout(
              () => {
                guild.members
                  .fetch(member.id)
                  .then((m) => {
                    m.roles.remove(mutedRole).catch(() => null);
                  })
                  .catch(() => null);
              },
              30 * 60 * 1000,
            );
          }
        }
      } catch (err) {
        console.error("Nie udało się dać muta/timeout po wysłaniu linka:", err);
      }

      // notify channel briefly
      try {
        const warn = await message.channel.send({
          content: `<@${message.author.id}>`,
          embeds: [
            new EmbedBuilder()
              .setColor(COLOR_RED)
              .setDescription(
                "• `❗` __**Wysyłanie linków Discord jest zabronione otrzymujesz mute na 30 minut**__",
              ),
          ],
        });
        setTimeout(() => warn.delete().catch(() => null), 6_000);
      } catch (e) {
        // ignore
      }
      return;
    }
  } catch (e) {
    console.error("Błąd podczas sprawdzania linków zaproszeń:", e);
  }

  // ANTI-MASS-PING: delete message and timeout user for 1 hour if 5+ pings in one message
  try {
    const content = message.content || "";
    // Catch all types of mentions: @user, @!user, @here, @everyone, and role mentions
    const mentionRegex = /<@!?(\d+)>|@here|@everyone|<@&(\d+)>/g;
    const mentions = content.match(mentionRegex) || [];
    
    if (mentions.length >= 5) {
      // delete message first
      try {
        await message.delete();
      } catch (e) {
        // ignore
      }
      
      // attempt to timeout the member for 1 hour (3600 seconds)
      try {
        const member = message.member;
        const guild = message.guild;
        
        if (member && typeof member.timeout === "function") {
          const ms = 60 * 60 * 1000; // 1 hour
          await member.timeout(ms, "Masowy ping - 5+ oznaczeń w jednej wiadomości");
        } else {
          // fallback: try to add a muted role named 'Muted' (best-effort)
          let mutedRole = guild.roles.cache.find(
            (r) => r.name.toLowerCase() === "muted",
          );
          if (!mutedRole) {
            try {
              mutedRole = await guild.roles.create({ 
                name: "Muted", 
                permissions: [],
                reason: "Rola dla masowego pingowania"
              });
            } catch (e) {
              mutedRole = null;
            }
          }
          
          if (mutedRole) {
            await member.roles.add(mutedRole, "Masowy ping - 5+ oznaczeń");
            
            // schedule removal in 1 hour
            setTimeout(async () => {
              try {
                const guildMember = await guild.members.fetch(member.id).catch(() => null);
                if (guildMember) {
                  await guildMember.roles.remove(mutedRole, "Automatyczne usunięcie mute po 1h");
                }
              } catch (e) {
                // ignore
              }
            }, 60 * 60 * 1000);
          }
        }
      } catch (err) {
        console.error("Nie udało się dać muta/timeout po masowym pingu:", err);
      }

      // notify channel briefly
      try {
        const warn = await message.channel.send({
          content: `<@${message.author.id}>`,
          embeds: [
            new EmbedBuilder()
              .setColor(COLOR_RED)
              .setDescription(
                "• `❗`  **__Masowy ping jest niedozwolony otrzymujesz mute na 1 godzine__**",
              ),
          ],
        });
        setTimeout(() => warn.delete().catch(() => null), 6_000);
      } catch (e) {
        // ignore
      }
      return;
    }
  } catch (e) {
    console.error("Błąd podczas sprawdzania masowych pingów:", e);
  }

  // Invalid-channel embeds (customized)
  const opinInvalidEmbed = new EmbedBuilder()
    .setColor(COLOR_RED)
    .setDescription(
      `• \`❗\` __**Na tym kanale można wystawiać tylko opinie!**__`,
    );

  const dropInvalidEmbed = new EmbedBuilder()
    .setColor(COLOR_RED)
    .setDescription(
      `• \`❗\` __**Na tym kanale można losować tylko zniżki!**__`,
    );

  try {
    const guildId = message.guildId;
    if (guildId) {
      const content = (message.content || "").trim();

      const dropChannelId = dropChannels.get(guildId);
      if (dropChannelId && message.channel.id === dropChannelId) {
        // Usuń każdą wiadomość użytkownika (także wpisane "/drop"), zostaw tylko slash-command
        if (!message.author.bot) {
          await message.delete().catch(() => null);
          return;
        }
      }

      const opinieChannelId = opinieChannels.get(guildId);
      if (opinieChannelId && message.channel.id === opinieChannelId) {
        if (!message.author.bot) {
          await message.delete().catch(() => null);
          return;
        }
      }

      const zapCh = message.guild
        ? message.guild.channels.cache.find(
          (c) =>
            c.type === ChannelType.GuildText &&
            (c.name === "❓-×┃sprawdz-zapro" ||
              c.name.includes("sprawdz-zapro") ||
              c.name.includes("sprawdz-zaproszenia")),
        )
        : null;

      if (zapCh && message.channel.id === zapCh.id) {
        if (!message.author.bot) {
          await message.delete().catch(() => null);
          return;
        }
      }
    }
  } catch (e) {
    console.error("Błąd przy egzekwowaniu reguł kanałów drop/opinia/zaproszenia:", e);
  }

  // Enforce zaproszenia-check-only channel rule:
  try {
    const content = (message.content || "").trim();
    const zapCh = message.guild
      ? message.guild.channels.cache.find(
        (c) =>
          c.type === ChannelType.GuildText &&
          (c.name === "❓-×┃sprawdz-zapro" ||
            c.name.includes("sprawdz-zapro") ||
            c.name.includes("sprawdz-zaproszenia")),
      )
      : null;

    if (zapCh && message.channel.id === zapCh.id) {
      // allow only if typed command starts with /sprawdz-zaproszenia
      if (!content.toLowerCase().startsWith("/sprawdz-zaproszenia")) {
        try {
          await message.delete().catch(() => null);
        } catch (e) { }
        return;
      } else {
        // typed the command - allow (but delete to reduce clutter)
        try {
          await message.delete().catch(() => null);
        } catch (e) { }
        return;
      }
    }
  } catch (e) {
    console.error("Błąd przy egzekwowaniu reguły kanału zaproszenia:", e);
  }

  // If any message is sent in the specific legitcheck-rep channel
  if (
    message.channel &&
    message.channel.id === REP_CHANNEL_ID &&
    !message.author.bot
  ) {
    console.log(`[+rep] Otrzymano wiadomość na kanale legit-rep: ${message.content} od ${message.author.tag}`);
    try {
      // ignore empty messages or slash-like content
      if (!message.content || message.content.trim().length === 0) return;
      if (message.content.trim().startsWith("/")) return;

      const channel = message.channel;
      const messageContent = message.content.trim();
      const now = Date.now();
      const COOLDOWN_MS = 15 * 60 * 1000; // 15 minut

      // Cooldown dla autora (15 min po poprawnym +rep)
      const lastRepTs = legitRepCooldown.get(message.author.id);
      if (lastRepTs && now - lastRepTs < COOLDOWN_MS) {
        const remaining = COOLDOWN_MS - (now - lastRepTs);
        await message.delete().catch(() => null);
        const cooldownEmbed = new EmbedBuilder()
          .setColor(COLOR_BLUE)
          .setDescription(
            "```\n" +
            "✅ New Shop × LEGIT CHECK\n" +
            "```\n" +
            `<a:arrowwhite:1469100658606211233> **__Stop!__**\n` +
            `<a:arrowwhite:1469100658606211233> Możesz wystawić następnego **legit repa** za \`${humanizeMs(remaining)}\`!`
          )
          .setTimestamp();
        message.author.send({ embeds: [cooldownEmbed] }).catch(() => null);
        return;
      }

      // Wzorzec: +rep @sprzedawca [sprzedał/kupił/wręczył nagrodę] [ile] [serwer]
      const mentionPattern = /<@!?\d+>|@\S+/;
      const repPattern = /^\+rep\s+(<@!?\d+>|@\S+)\s+(sprzedał|sprzedal|kupił|kupil|wręczył\s+nagrodę|wreczyl\s+nagrode)\s+(.+\s.+)$/i;
      const hasMention = mentionPattern.test(messageContent);
      const isValidRep = repPattern.test(messageContent);

      console.log(`[+rep] Otrzymano wiadomość: "${messageContent}" | hasMention=${hasMention} | valid=${isValidRep}`);

      if (!hasMention) {
        try {
          await message.delete();
          const warningEmbed = new EmbedBuilder()
            .setColor(COLOR_RED)
            .setDescription(`• \`❗\` × __**Stosuj się do wzoru legit checka!**__`);
          const warnMsg = await channel.send({ content: `<@${message.author.id}>`, embeds: [warningEmbed] });
          setTimeout(() => warnMsg.delete().catch(() => null), 8000);
        } catch (err) {
          console.error("Błąd usuwania nieoznaczonego legit-rep:", err);
        }
        return;
      }

      if (!isValidRep) {
        try {
          await message.delete();
          const warningEmbed = new EmbedBuilder()
            .setColor(COLOR_RED)
            .setDescription(
              `• \`❗\` × __**Stosuj się do wzoru legit checka!**__`,
            );

          const warnMsg = await channel.send({ content: `<@${message.author.id}>`, embeds: [warningEmbed] });
          setTimeout(() => warnMsg.delete().catch(() => null), 8000);
        } catch (err) {
          console.error("Błąd usuwania nieprawidłowego legit-rep:", err);
        }
        return;
      }

      // Valid +rep message - increment counter + cooldown
      legitRepCount++;
      legitRepCooldown.set(message.author.id, now);
      console.log(`+rep otrzymany! Licznik: ${legitRepCount}`);

      // Sprawdź czy istnieje ticket oczekujący na +rep od tego użytkownika
      try {
        const senderId = message.author.id; // ID osoby która wysłała +rep
        console.log(`[+rep] Sprawdzam tickety oczekujące na +rep od użytkownika ${senderId}`);
        
        // Przeszukaj wszystkie tickety oczekujące na +rep
        for (const [ticketChannelId, ticketData] of pendingTicketClose.entries()) {
          console.log(`[+rep] Sprawdzam ticket ${ticketChannelId}: awaitingRep=${ticketData.awaitingRep}, userId=${ticketData.userId}`);
          if (
            ticketData.awaitingRep &&
            ticketData.userId === senderId &&
            channel.id === ticketData.legitRepChannelId
          ) {
            // Sprawdź czy w wiadomości +rep jest wzmianka o sprzedawcy/używającym komendę
            const expectedUsername = ticketData.commandUsername;
            const expectedId = ticketData.commandUserId;
            const msgContent = message.content.trim();

            const mentionMatchesSeller = message.mentions.users.has(expectedId);
            const usernameIncluded = msgContent.includes(`@${expectedUsername}`);

            if (mentionMatchesSeller || usernameIncluded) {
              console.log(`Znaleziono ticket ${ticketChannelId} - twórca ticketu ${senderId} wysłał +rep dla ${expectedUsername}`);
              const ticketChannel = await client.channels.fetch(ticketChannelId).catch(() => null);
              if (ticketChannel) {
                try {
                  const ticketMeta = ticketOwners.get(ticketChannelId) || null;
                  await archiveTicketOnClose(
                    ticketChannel,
                    message.author.id,
                    ticketMeta,
                  ).catch((e) => console.error("archiveTicketOnClose error (+rep):", e));
                  await ticketChannel.delete('Ticket zamknięty po otrzymaniu +rep');
                  pendingTicketClose.delete(ticketChannelId);
                  ticketOwners.delete(ticketChannelId);
                  console.log(`Ticket ${ticketChannelId} został zamknięty po +rep`);
                } catch (closeErr) {
                  console.error(`Błąd zamykania ticketu ${ticketChannelId}:`, closeErr);
                }
              }
            }
          }
        }
      } catch (ticketErr) {
        console.error("Błąd sprawdzania ticketów oczekujących na +rep:", ticketErr);
      }

      // Use scheduled rename (respect cooldown)
      scheduleRepChannelRename(channel, legitRepCount).catch(() => null);
      scheduleSavePersistentState();

      // cooldown per user for info embed
      const last = infoCooldowns.get(message.author.id) || 0;
      if (Date.now() - last < INFO_EMBED_COOLDOWN_MS) {
        console.log(`Cooldown dla ${message.author.username}, pomijam embed`);
        return;
      }
      infoCooldowns.set(message.author.id, Date.now());
      console.log(`Wysyłam embed dla ${message.author.username}`);

      // delete previous info message (if we posted one earlier in this channel) to move new one to bottom
      const prevId = repLastInfoMessage.get(channel.id);
      if (prevId) {
        try {
          const prevMsg = await channel.messages.fetch(prevId).catch(() => null);
          if (prevMsg && prevMsg.deletable) {
            await prevMsg.delete().catch(() => null);
          }
        } catch (delErr) {
          console.warn(
            "Nie udało się usunąć poprzedniej wiadomości info:",
            delErr,
          );
        }
      }

      // ID użytkownika
      const userID = "1305200545979437129";

      let attachment = null;
      let imageUrl = "https://share.creavite.co/693f180207e523c90b19fbf9.gif"; // fallback URL

      try {
        const gifPath = path.join(
          __dirname,
          "attached_assets",
          "standard_1765794552774_1766946611654.gif",
        );
        attachment = new AttachmentBuilder(gifPath, { name: "legit.gif" });
        imageUrl = "attachment://legit.gif";
      } catch (err) {
        console.warn(
          "Nie udało się załadować lokalnego GIFa do legit embed:",
          err,
        );
        attachment = null;
      }

      const infoEmbed = new EmbedBuilder()
        .setColor(COLOR_BLUE) // informational embed left color -> blue (rest is blue)
        .setDescription(
          "```\n" +
          "✅ New Shop × LEGIT CHECK\n" +
          "```\n" +
          "- `📝` **× Jak napisać:**\n" +
          `> \`+rep @sprzedawca [sprzedał/kupił/wręczył nagrodę] [co] [serwer]\`\n\n` +
          "- `📋` **× Przykład:**\n" +
          `> **+rep <@1305200545979437129> sprzedał 400k anarchia lf**\n\n` +
          `*Aktualna liczba legitcheck: **${legitRepCount}***`,
        )
        .setImage(imageUrl);

      // Always send a new info message (after deleting the previous one) so it appears below the new +rep
      try {
        const sendOptions = {
          embeds: [infoEmbed],
          allowedMentions: { users: [userID] },
        };
        if (attachment) sendOptions.files = [attachment];

        const sent = await channel.send(sendOptions);
        repLastInfoMessage.set(channel.id, sent.id);
      } catch (err) {
        console.error("Błąd wysyłania info embed (nowy):", err);
      }
    } catch (err) {
      console.error("Błąd wysyłania info embed na legitcheck-rep:", err);
    }
  }

  if (message.content.toLowerCase().trim() === "legit") {
    // legacy: no legit flows for now
    return;
  }

  if (message.content === "!ping") {
    message.reply("Pong!");
  }
});

// ----------------- OPINIA handler (updated to match provided layout + delete & re-send instruction so it moves to bottom) -----------------

async function handleOpinionCommand(interaction) {
  const guildId = interaction.guildId;
  if (!guildId || !interaction.guild) {
    await interaction.reply({
      content: "> `❌` × **Ta komenda** działa tylko na **serwerze**!",
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // Enforce per-user cooldown for /opinia (30 minutes)
  const lastUsed = opinionCooldowns.get(interaction.user.id) || 0;
  if (Date.now() - lastUsed < OPINION_COOLDOWN_MS) {
    const remaining = OPINION_COOLDOWN_MS - (Date.now() - lastUsed);
    await interaction.reply({
      content: `> \`❌\` × Możesz użyć komendy </opinia:1464015495392133321> ponownie za \`${humanizeMs(remaining)}\``,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const normalize = (s = "") =>
    s
      .toString()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9 _-]/gi, "")
      .trim()
      .toLowerCase();

  let allowedChannelId = opinieChannels.get(guildId);
  if (!allowedChannelId) {
    const found = interaction.guild.channels.cache.find(
      (c) =>
        c.type === ChannelType.GuildText &&
        (c.name === "⭐-×┃opinie-klientow" ||
          normalize(c.name).includes("opinie") ||
          normalize(c.name).includes("opinie-klientow")),
    );
    if (found) {
      allowedChannelId = found.id;
      opinieChannels.set(guildId, found.id);
    }
  }

  if (!allowedChannelId || interaction.channelId !== allowedChannelId) {
    await interaction.reply({
      content: `> \`❌\` × Użyj tej **komendy** na kanale <#${allowedChannelId || "⭐-×┃opinie-klientow"}>.`,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // mark cooldown (successful invocation)
  opinionCooldowns.set(interaction.user.id, Date.now());

  // Pobranie opcji
  const czas = interaction.options.getInteger("czas_oczekiwania");
  const jakosc = interaction.options.getInteger("jakosc_produktu");
  const cena = interaction.options.getInteger("cena_produktu");
  const tresc = interaction.options.getString("tresc_opinii");

  // helper na gwiazdki
  const stars = (n) => {
    const count = Math.max(0, Math.min(5, n || 0));
    if (count === 0) return null;
    return "⭐".repeat(count);
  };
  const starsInline = (n) => {
    const s = stars(n);
    return s ? `\`${s}\`` : "Brak ocena";
  };

  // wrap tresc in inline code backticks so it appears with dark bg in embed
  const safeTresc = tresc ? `\`${tresc}\`` : "`-`";

  // Budujemy opis jako pojedynczy string — używamy tablicy i join(\n) żeby zachować czytelność
  const description = [
    "```",
    "✅ New Shop × OPINIA",
    "```",
    `> \`👤\` **× Twórca opinii:** <@${interaction.user.id}>`,
    `> \`📝\` **× Treść:** ${safeTresc}`,
    "",
    `> \`⌛\` **× Czas oczekiwania:** ${starsInline(czas)}`,
    `> \`📋\` **× Jakość produktu:** ${starsInline(jakosc)}`,
    `> \`💸\` **× Cena produktu:** ${starsInline(cena)}`,
  ].join("\n");

  // Tworzymy embed z poprawnym description
  const opinionEmbed = new EmbedBuilder()
    .setColor(COLOR_BLUE)
    .setDescription(description)
    .setThumbnail(
      interaction.user.displayAvatarURL({ dynamic: true, size: 128 }),
    )
    .setTimestamp();

  // instrukcja — będzie na żółto i użyje mention dla komendy /opinia
  const instructionEmbed = new EmbedBuilder()
    .setColor(0xffd700)
    .setDescription(
      "`📊` × Użyj **komendy** </opinia:1464015495392133321>, aby podzielić się opinią o naszym serwerze!",
    );
  try {
    const channel = interaction.channel;

    // Spróbuj użyć webhooka do wysłania opinii z nazwą równą displayName użytkownika
    // (wygląda jakby wysłał użytkownik — ale to nadal webhook)
    let botWebhook = null;
    try {
      const webhooks = await channel.fetchWebhooks();
      botWebhook = webhooks.find(
        (w) => w.owner?.id === client.user.id && w.name === "ZAKUP_ITy_OPINIE",
      );
    } catch (e) {
      botWebhook = null;
    }

    if (!botWebhook) {
      try {
        botWebhook = await channel.createWebhook({
          name: "ZAKUP_ITy_OPINIE",
          avatar: client.user.displayAvatarURL({ dynamic: true }),
          reason: "Webhook do publikowania opinii",
        });
      } catch (createErr) {
        botWebhook = null;
      }
    }

    if (botWebhook) {
      const displayName =
        interaction.member?.displayName || interaction.user.username;
      await botWebhook.send({
        username: displayName,
        avatarURL: interaction.user.displayAvatarURL({ dynamic: true }),
        embeds: [opinionEmbed],
        wait: true,
      });
    } else {
      await channel.send({ embeds: [opinionEmbed] });
    }

    // Delete previous instruction message (if exists) so the new one will be posted BELOW the just-sent opinion
    const channelId = channel.id;
    let instrMsg = null;

    if (lastOpinionInstruction.has(channelId)) {
      instrMsg = await channel.messages
        .fetch(lastOpinionInstruction.get(channelId))
        .catch(() => null);
      if (!instrMsg) lastOpinionInstruction.delete(channelId);
    }

    if (!instrMsg) {
      // try to find in recent messages one with the same description (old instruction leftover)
      const found = await findBotMessageWithEmbed(
        channel,
        (emb) =>
          typeof emb.description === "string" &&
          (emb.description.includes(
            "Użyj **komendy** </opinia:1464015495392133321>",
          ) ||
            emb.description.includes("Użyj **komendy** `/opinia`")),
      );
      if (found) instrMsg = found;
    }

    if (instrMsg) {
      try {
        if (instrMsg.deletable) {
          await instrMsg.delete().catch(() => null);
        }
      } catch (e) {
        // ignore
      }
      lastOpinionInstruction.delete(channelId);
    }

    // Send a fresh instruction message (so it will be at the bottom)
    try {
      const sent = await channel.send({ embeds: [instructionEmbed] });
      lastOpinionInstruction.set(channelId, sent.id);
    } catch (e) {
      // ignore (maybe no perms)
    }

    await interaction.reply({
      content: "> `✅` × **Twoja opinia** została opublikowana.",
      flags: [MessageFlags.Ephemeral],
    });
  } catch (err) {
    console.error("Błąd publikacji opinii:", err);
    try {
      await interaction.reply({
        content: "> `❌` × **Wystąpił** błąd podczas publikacji **opinii**.",
        flags: [MessageFlags.Ephemeral],
      });
    } catch (e) {
      // ignore
    }
  }
}
// ---------------------------------------------------

// Helper sleep
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/*
  NEW: /wyczysckanal handler
  - tryb: "wszystko" -> usuwa jak najwięcej wiadomości (pomija pinned)
  - tryb: "ilosc" -> usuwa określoną ilość (1-100)
  Notes:
  - Bulk delete nie usuwa wiadomości starszych niż 14 dni; w tym przypadku pojedyncze usuwanie jest używane jako fallback (może być wolne).
  - Command requires ManageMessages permission by default (set in command registration) but we double-check at runtime.
*/
async function handleWyczyscKanalCommand(interaction) {
  const guildId = interaction.guildId;
  const channel = interaction.channel;

  if (!guildId || !interaction.guild) {
    await interaction.reply({
      content: "> `❌` × **Ta komenda** działa tylko na **serwerze**!",
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // Defer to avoid timeout and allow multiple replies
  await interaction.deferReply({ flags: [MessageFlags.Ephemeral] }).catch(() => null);

  // only text channels
  if (
    !channel ||
    (channel.type !== ChannelType.GuildText &&
      channel.type !== ChannelType.GuildVoice &&
      channel.type !== ChannelType.GuildAnnouncement &&
      channel.type !== ChannelType.GuildForum &&
      channel.type !== ChannelType.GuildStageVoice &&
      channel.type !== ChannelType.GuildCategory)
  ) {
    // simpler: require GuildText
    if (channel.type !== ChannelType.GuildText) {
      try {
        await interaction.editReply({
          content:
            "❌ Ta komenda działa tylko na zwykłych kanałach tekstowych (nie w prywatnych wiadomościach).",
        });
      } catch (e) {
        // ignore
      }
      return;
    }
  }

  const mode = interaction.options.getString("tryb");
  const amount = interaction.options.getInteger("ilosc") || 0;

  try {
    if (mode === "ilosc") {
      // validate amount
      if (amount <= 0 || amount > 100) {
        try {
          await interaction.editReply({
            content: "> `❌` × **Podaj** poprawną ilość wiadomości do usunięcia (1-100).",
          });
        } catch (e) {
          // ignore
        }
        return;
      }

      // Use bulkDelete with filterOld = true to avoid error on >14days messages
      const deleted = await channel.bulkDelete(amount, true);
      const deletedCount = deleted.size || 0;

      try {
        await interaction.editReply({
          content: `✅ Usunięto ${deletedCount} wiadomości z tego kanału.`,
        });
      } catch (e) {
        // ignore
      }
      return;
    }

    if (mode === "wszystko") {
      try {
        await interaction.editReply({
          content:
            "🧹 Rozpoczynam czyszczenie kanału. To może potrwać (usuwam wszystkie nie-przypięte wiadomości)...",
        });
      } catch (e) {
        // ignore
      }

      let totalDeleted = 0;
      // loop fetching up to 100 messages and deleting them until none left (or stuck)
      while (true) {
        // fetch up to 100 messages
        const fetched = await channel.messages.fetch({ limit: 100 });
        if (!fetched || fetched.size === 0) break;

        // filter out pinned messages
        const toDelete = fetched.filter((m) => !m.pinned);

        if (toDelete.size === 0) {
          // nothing to delete in this batch (all pinned) -> stop
          break;
        }

        try {
          // bulkDelete with filterOld true to avoid errors on >14d
          const deleted = await channel.bulkDelete(toDelete, true);
          const count = deleted.size || 0;
          totalDeleted += count;

          // If some messages couldn't be bulk-deleted because older than 14 days,
          // bulkDelete will just skip them when filterOld = true, so handle leftovers manually.
          // Collect leftovers (those not deleted and not pinned) and delete individually.
          const remaining = toDelete.filter((m) => !deleted.has(m.id));
          if (remaining.size > 0) {
            for (const m of remaining.values()) {
              try {
                await m.delete().catch(() => null);
                totalDeleted++;
                // small delay to avoid rate limits
                await sleep(200);
              } catch (err) {
                // ignore single deletion errors
              }
            }
          }
        } catch (err) {
          // fallback: if bulkDelete fails for any reason, delete individually
          console.warn(
            "bulkDelete nie powiodło się, przechodzę do indywidualnego usuwania:",
            err,
          );
          for (const m of toDelete.values()) {
            try {
              await m.delete().catch(() => null);
              totalDeleted++;
              await sleep(200);
            } catch (e) {
              // ignore
            }
          }
        }

        // small pause to be polite with rate limits
        await sleep(500);

        // try next batch
      }

      await interaction.editReply({
        content: `✅ Czyszczenie zakończone. Usunięto około ${totalDeleted} wiadomości. (Pamiętaj: wiadomości przypięte zostały zachowane, a wiadomości starsze niż 14 dni mogły być usunięte indywidualnie lub pominięte).`,
      });
      return;
    }

    try {
      await interaction.editReply({
        content: "> `❌` × **Nieznany** tryb. Wybierz '**wszystko**' lub '**ilosc**'.",
      });
    } catch (e) {
      // ignore
    }
  } catch (error) {
    console.error("Błąd wyczyszczenia kanału:", error);
    try {
      await interaction.editReply({
        content: "> `❌` × **Wystąpił** błąd podczas czyszczenia **kanału**.",
      });
    } catch (e) {
      // ignore
    }
  }
}

/*
  NEW: schedule and perform rep channel rename while respecting cooldown
  - If immediate rename allowed (cooldown passed), perform now.
  - Otherwise schedule a single delayed rename to occur when cooldown ends.
  - pendingRename prevents multiple overlapping scheduled renames.
*/
async function scheduleRepChannelRename(channel, count) {
  if (!channel || typeof channel.setName !== "function") return;

  const newName = `✅-×┃legit-rep➔${count}`;
  const now = Date.now();
  const since = now - lastChannelRename;
  const remaining = Math.max(0, CHANNEL_RENAME_COOLDOWN - since);

  if (remaining === 0 && !pendingRename) {
    // do it now
    pendingRename = true;
    try {
      await channel.setName(newName);
      lastChannelRename = Date.now();
      console.log(`Zmieniono nazwę kanału na: ${newName}`);
    } catch (err) {
      console.error("Błąd zmiany nazwy kanału (natychmiastowa próba):", err);
    } finally {
      pendingRename = false;
    }
  } else {
    // schedule once (if not already scheduled)
    if (pendingRename) {
      // already scheduled — we won't schedule another to avoid piling many timeouts.
      console.log(
        `Zmiana nazwy kanału już zaplanowana. Nowa nazwa zostanie ustawiona przy najbliższej okazji: ${newName}`,
      );
      return;
    }

    pendingRename = true;
    const when = lastChannelRename + CHANNEL_RENAME_COOLDOWN;
    const delay = Math.max(0, when - now) + 1000; // add small safety buffer
    console.log(`Planuję zmianę nazwy kanału na ${newName} za ${delay} ms`);

    setTimeout(async () => {
      try {
        await channel.setName(newName);
        lastChannelRename = Date.now();
        console.log(`Zaplanowana zmiana nazwy wykonana: ${newName}`);
      } catch (err) {
        console.error("Błąd zmiany nazwy kanału (zaplanowana próba):", err);
      } finally {
        pendingRename = false;
      }
    }, delay);
  }
}

/*
  NEW: /resetlc handler
  - Admin-only command (default member permission set)
  - Resets legitRepCount to 0 and attempts to rename the counter channel.
  - If rename cannot be performed immediately due to cooldown, it will be scheduled.
*/
async function handleResetLCCommand(interaction) {
  // ensure command used in guild
  if (!interaction.guild) {
    try {
      await interaction.reply({
        content: "> `❌` × **Ta komenda** działa tylko na **serwerze**!",
        flags: [MessageFlags.Ephemeral],
      });
    } catch (e) {
      console.error("Nie udało się odpowiedzieć (brak guild):", e);
    }
    return;
  }

  // Sprawdź czy właściciel
  if (interaction.user.id !== interaction.guild.ownerId) {
    try {
      await interaction.reply({
        content: "> `❗` × Brak wymaganych uprawnień.",
        flags: [MessageFlags.Ephemeral],
      });
    } catch (e) {
      console.error("Nie udało się odpowiedzieć o braku uprawnień:", e);
    }
    return;
  }

  // Defer reply to avoid "App is not responding" while we perform work
  try {
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
  } catch (e) {
    console.warn("Nie udało się deferReply (może już odpowiedziano):", e);
  }

  console.log(
    `[resetlc] Użytkownik ${interaction.user.tag} (${interaction.user.id}) żąda resetu licznika.`,
  );

  // reset counter
  legitRepCount = 0;
  scheduleSavePersistentState();

  try {
    const channel = await client.channels
      .fetch(REP_CHANNEL_ID)
      .catch(() => null);
    if (!channel) {
      console.warn(
        `[resetlc] Nie znaleziono kanału o ID ${REP_CHANNEL_ID} lub bot nie ma do niego dostępu.`,
      );
      await interaction.editReply({
        content:
          "✅ Licznik został zresetowany lokalnie, ale nie udało się znaleźć kanału z licznikiem (sprawdź REP_CHANNEL_ID i uprawnienia bota).",
      });
      return;
    }

    // Try immediate rename if cooldown allows, otherwise schedule
    const now = Date.now();
    const since = now - lastChannelRename;
    const remaining = Math.max(0, CHANNEL_RENAME_COOLDOWN - since);

    if (remaining === 0 && !pendingRename) {
      try {
        // attempt immediate rename (may fail if missing ManageChannels)
        await channel.setName(`✅-×┃legit-rep➔${legitRepCount}`);
        lastChannelRename = Date.now();
        pendingRename = false;
        console.log(`[resetlc] Kanał ${channel.id} zaktualizowany do 0.`);
        await interaction.editReply({
          content:
            "✅ Licznik legitchecków został zresetowany do 0, nazwa kanału została zaktualizowana.",
        });
        return;
      } catch (err) {
        console.error(
          "[resetlc] Błąd przy natychmiastowej zmianie nazwy kanału:",
          err,
        );
        // fallback to scheduling
        await scheduleRepChannelRename(channel, legitRepCount);
        await interaction.editReply({
          content:
            "✅ Licznik został zresetowany do 0. Nie udało się natychmiast zaktualizować nazwy kanału — zmiana została zaplanowana.",
        });
        return;
      }
    } else {
      // schedule rename respecting cooldown
      await scheduleRepChannelRename(channel, legitRepCount);
      await interaction.editReply({
        content:
          "✅ Licznik został zresetowany do 0. Nazwa kanału zostanie zaktualizowana za kilka minut (szanujemy cooldown Discorda).",
      });
      return;
    }
  } catch (err) {
    console.error("[resetlc] Błąd podczas resetowania licznika:", err);
    try {
      await interaction.editReply({
        content: "> `❌` × **Wystąpił** błąd podczas resetowania **licznika**.",
      });
    } catch (e) {
      console.error("Nie udało się wysłać editReply po błędzie:", e);
    }
  }
}

/*
  NEW: /zresetujczasoczekiwania handler
  - Admin-only command that clears cooldowns for /drop and /opinia (and internal info).
*/
async function handleZresetujCzasCommand(interaction) {
  if (!interaction.guild) {
    await interaction.reply({
      content: "> `❌` × **Ta komenda** działa tylko na **serwerze**!",
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // Sprawdź czy właściciel
  if (interaction.user.id !== interaction.guild.ownerId) {
    await interaction.reply({
      content: "> `❗` × Brak wymaganych uprawnień.",
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  try {
    const what = interaction.options.getString("co");
    const targetUser = interaction.options.getUser("kto") || interaction.user;
    const targetId = targetUser.id;
    const targets = [];
    if (what === "drop" || what === "all") {
      targets.push("/drop");
      dropCooldowns.delete(targetId);
    }
    if (what === "opinia" || what === "all") {
      targets.push("/opinia");
      opinionCooldowns.delete(targetId);
    }
    if (what === "zaproszenia" || what === "all") {
      targets.push("/sprawdz-zaproszenia");
      sprawdzZaproszeniaCooldowns.delete(targetId);
    }
    if (what === "rep" || what === "all") {
      targets.push("+rep");
      legitRepCooldown.delete(targetId);
    }

    infoCooldowns.delete(targetId); // reset internal info cooldown for target

    await interaction.reply({
      content: `✅ Zresetowano czas oczekiwania (${targets.join(', ') || 'brak'}) dla <@${targetId}>.`,
      flags: [MessageFlags.Ephemeral],
    });
    console.log(`[zco] ${interaction.user.tag} zresetował cooldowny: ${targets.join(', ')} dla ${targetUser.tag}`);
  } catch (err) {
    console.error("[zco] Błąd:", err);
    await interaction.reply({
      content: "> `❌` × **Wystąpił** błąd podczas resetowania czasów **oczekiwania**.",
      flags: [MessageFlags.Ephemeral],
    });
  }
}

// ----------------- Welcome message system + Invite tracking & protections -----------------
client.on(Events.GuildMemberAdd, async (member) => {
  try {
    // find channel by exact name or containing 'lobby'
    const ch =
      member.guild.channels.cache.find(
        (c) =>
          c.type === ChannelType.GuildText &&
          (c.name === "👋-×┃lobby" || c.name.toLowerCase().includes("lobby")),
      ) || null;

    // --- Robust invite detection ---
    let inviterId = null;
    let countThisInvite = false;
    let isFakeAccount = false;

    try {
      // jeśli ten użytkownik wcześniej opuścił i mieliśmy to zapisane -> usuń "leave" (kompensacja)
      const memberKey = `${member.guild.id}:${member.id}`;
      if (leaveRecords.has(memberKey)) {
        try {
          const prevInviter = leaveRecords.get(memberKey);
          if (prevInviter) {
            if (!inviteLeaves.has(member.guild.id))
              inviteLeaves.set(member.guild.id, new Map());
            const lMap = inviteLeaves.get(member.guild.id);
            const prevLeft = lMap.get(prevInviter) || 0;
            lMap.set(prevInviter, Math.max(0, prevLeft - 1));
            inviteLeaves.set(member.guild.id, lMap);
            scheduleSavePersistentState();
          }
        } catch (e) {
          console.warn("Error compensating leave on rejoin:", e);
        } finally {
          leaveRecords.delete(memberKey);
          scheduleSavePersistentState();
        }
      }

      // fetch current invites
      const currentInvites = await member.guild.invites
        .fetch()
        .catch(() => null);

      if (currentInvites) {
        // previous cached map (may be empty)
        const prevMap = guildInvites.get(member.guild.id) || new Map();

        // build new map & detect which invite increased
        const newMap = new Map();
        for (const inv of currentInvites.values()) {
          newMap.set(inv.code, inv.uses || 0);
        }

        for (const inv of currentInvites.values()) {
          const prevUses = prevMap.get(inv.code) || 0;
          const nowUses = inv.uses || 0;
          if (nowUses > prevUses) {
            inviterId = inv.inviter ? inv.inviter.id : null;
            countThisInvite = true;
            break;
          }
        }

        // update cache (always)
        guildInvites.set(member.guild.id, newMap);
      } else {
        console.warn(
          `[invites] Nie udało się pobrać invite'ów dla guild ${member.guild.id} — sprawdź uprawnienia bota (MANAGE_GUILD).`,
        );
      }
    } catch (e) {
      console.error("Błąd podczas wykrywania invite:", e);
    }

    // Simple fake-account detection (~2 months)
    try {
      const ACCOUNT_AGE_THRESHOLD_MS = 60 * 24 * 60 * 60 * 1000;
      const accountAgeMs =
        Date.now() - (member.user.createdTimestamp || Date.now());
      isFakeAccount = accountAgeMs < ACCOUNT_AGE_THRESHOLD_MS;
      
      // Debug: loguj wiek konta
      const accountAgeDays = Math.floor(accountAgeMs / (24 * 60 * 60 * 1000));
      console.log(`[invite] Konto ${member.user.tag} (${member.id}) ma ${accountAgeDays} dni. Fake: ${isFakeAccount}`);
    } catch (e) {
      isFakeAccount = false;
    }

    // Rate-limit per inviter to avoid abuse (only if we detected inviter)
    if (inviterId && countThisInvite) {
      if (!inviterRateLimit.has(member.guild.id))
        inviterRateLimit.set(member.guild.id, new Map());
      const rateMap = inviterRateLimit.get(member.guild.id);
      if (!rateMap.has(inviterId)) rateMap.set(inviterId, []);
      const timestamps = rateMap.get(inviterId);

      const cutoff = Date.now() - INVITER_RATE_LIMIT_WINDOW_MS;
      const recent = timestamps.filter((t) => t > cutoff);
      recent.push(Date.now());
      rateMap.set(inviterId, recent);
      inviterRateLimit.set(member.guild.id, rateMap);
      scheduleSavePersistentState();

      if (recent.length > INVITER_RATE_LIMIT_MAX) {
        // too many invites in the window -> mark as not counted
        countThisInvite = false;
        console.log(
          `[invites][ratelimit] Nie dodaję zaproszenia dla ${inviterId} - przekroczono limit w oknie.`,
        );
      }
    }

    // If we detected an inviter (even if not counted due to rate-limit, inviterId may be present)
    let fakeMap = null;
    const ownerId = "1305200545979437129";

    if (inviterId) {
      // Ensure all maps exist
      if (!inviteCounts.has(member.guild.id))
        inviteCounts.set(member.guild.id, new Map());
      if (!inviteRewards.has(member.guild.id))
        inviteRewards.set(member.guild.id, new Map());
      if (!inviteRewardsGiven.has(member.guild.id))
        inviteRewardsGiven.set(member.guild.id, new Map());
      if (!inviteLeaves.has(member.guild.id))
        inviteLeaves.set(member.guild.id, new Map());
      if (!inviteTotalJoined.has(member.guild.id))
        inviteTotalJoined.set(member.guild.id, new Map());
      if (!inviteFakeAccounts.has(member.guild.id))
        inviteFakeAccounts.set(member.guild.id, new Map());
      if (!inviteBonusInvites.has(member.guild.id))
        inviteBonusInvites.set(member.guild.id, new Map());

      const gMap = inviteCounts.get(member.guild.id); // prawdziwe zaproszenia
      const totalMap = inviteTotalJoined.get(member.guild.id); // wszystkie joiny
      fakeMap = inviteFakeAccounts.get(member.guild.id); // fake

      // Always increment totalJoined (wszystkie dołączenia przypisane do zapraszającego)
      const prevTotal = totalMap.get(inviterId) || 0;
      totalMap.set(inviterId, prevTotal + 1);
      inviteTotalJoined.set(member.guild.id, totalMap);
      scheduleSavePersistentState();

      // Liczymy zaproszenia tylko jeśli nie jest właścicielem
      if (inviterId !== ownerId) {
        // ZAWSZE liczymy zaproszenia z kont < 2 mies.
        if (!isFakeAccount) {
          const prev = gMap.get(inviterId) || 0;
          gMap.set(inviterId, prev + 1);
          inviteCounts.set(member.guild.id, gMap);
          scheduleSavePersistentState(true); // Natychmiastowy zapis
        }
      }

      // --- Nagrody za zaproszenia ---
      let rewardsGivenMap = inviteRewardsGiven.get(member.guild.id);
      if (!rewardsGivenMap) {
        rewardsGivenMap = new Map();
        inviteRewardsGiven.set(member.guild.id, rewardsGivenMap);
      }

      const alreadyGiven = rewardsGivenMap.get(inviterId) || 0;
      const currentCount = gMap.get(inviterId) || 0;

      // ile nagród powinno być przyznanych
      const eligibleRewards = Math.floor(
        currentCount / INVITE_REWARD_THRESHOLD,
      );
      const toGive = Math.max(0, eligibleRewards - alreadyGiven);

      if (toGive > 0) {
        rewardsGivenMap.set(inviterId, alreadyGiven + toGive);
        inviteRewardsGiven.set(member.guild.id, rewardsGivenMap);
        scheduleSavePersistentState(true); // Natychmiastowy zapis

        // Przygotuj kanał zaproszeń
        const zapCh =
          member.guild.channels.cache.find(
            (c) =>
              c.type === ChannelType.GuildText &&
              (c.name === "📨-×┃zaproszenia" ||
                c.name.toLowerCase().includes("zaproszen") ||
                c.name.toLowerCase().includes("zaproszenia")),
          ) || null;

        // Dla każdej nagrody
        for (let i = 0; i < toGive; i++) {
          const rewardCode = generateCode();
          const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24 godziny
          const expiryTs = Math.floor(expiresAt / 1000);

          // Zapisz kod
          activeCodes.set(rewardCode, {
            oderId: inviterId,
            rewardAmount: 50000,
            rewardText: "50k$",
            type: "invite_cash",
            created: Date.now(),
            expiresAt,
          });
          scheduleSavePersistentState();

          // Wyślij DM
          try {
            const user = await client.users.fetch(inviterId);
            const dmEmbed = new EmbedBuilder()
              .setColor(0xd4af37)
              .setDescription(
                "```\n" +
                "🎀 New Shop × NAGRODA\n" +
                "```\n" +
                `\`👤\` × **Użytkownik:** ${user}\n` +
                `\`🎉\` × **Gratulacje! Otrzymałeś nagrodę za zaproszenia!**\n` +
                `\`💸\` × **Kod nagrody:**\n` +
                "```\n" +
                rewardCode +
                "\n```\n" +
                `\`💰\` × **Wartość:** \`50k\$\`\n` +
                `\`🕑\` × **Kod wygaśnie za:** <t:${expiryTs}:R>\n\n` +
                `\`❔\` × Aby zrealizować kod utwórz nowy ticket, wybierz kategorię\n` +
                `\`Odbiór nagrody\` i w polu wpisz otrzymany kod.`
              )
              .setTimestamp();

            await user.send({ embeds: [dmEmbed] });
          } catch (e) {
            console.error("Błąd wysyłania DM z nagrodą:", e);
            // Fallback: wyślij na kanał zaproszeń
          }
        }
      }
    }

    // Jeśli konto jest fake (< 4 mies.), dodajemy tylko do licznika fake
    if (isFakeAccount && inviterId) {
      if (!inviteFakeAccounts.has(member.guild.id))
        inviteFakeAccounts.set(member.guild.id, new Map());
      const fakeMapLocal = fakeMap || inviteFakeAccounts.get(member.guild.id);
      const prevFake = fakeMapLocal.get(inviterId) || 0;
      fakeMapLocal.set(inviterId, prevFake + 1);
      inviteFakeAccounts.set(member.guild.id, fakeMapLocal);
      scheduleSavePersistentState();
    }

    // store who invited this member (and whether it was counted)
    const memberKey = `${member.guild.id}:${member.id}`;
    inviterOfMember.set(memberKey, {
      inviterId,
      counted: !!(countThisInvite && !isFakeAccount),
      isFake: !!isFakeAccount,
    });

    // persist join/invite state
    scheduleSavePersistentState(true); // Natychmiastowy zapis

    // Powiadomienie na kanale zaproszeń kto kogo dodał
    const zapChannelId = "1449159392388972554";
    const zapChannel = member.guild.channels.cache.get(zapChannelId);

    if (zapChannel && inviterId) {
      const gMap = inviteCounts.get(member.guild.id) || new Map();
      const currentInvites = gMap.get(inviterId) || 0;
      const inviteWord = getInviteWord(currentInvites);
      const ownerId = "1305200545979437129";
      
      try {
        let message;
        if (inviterId === ownerId) {
          // Zaproszenie przez właściciela - nie liczymy zaproszeń
          message = `> \`✉️\` × <@${inviterId}> zaprosił <@${member.id}> (został zaproszony przez właściciela)`;
        } else {
          // Normalne zaproszenie
          message = isFakeAccount 
            ? `> \`✉️\` × <@${inviterId}> zaprosił <@${member.id}> i ma teraz **${currentInvites}** ${inviteWord}! (konto ma mniej niż 2 mies.)`
            : `> \`✉️\` × <@${inviterId}> zaprosił <@${member.id}> i ma teraz **${currentInvites}** ${inviteWord}!`;
        }
        await zapChannel.send(message);
      } catch (e) { }
    }

    // Send welcome embed (no inviter details here)
    if (ch) {
      const embed = new EmbedBuilder()
        .setColor(COLOR_BLUE)
        .setDescription(
          "```\n" +
          "👋 New Shop × LOBBY\n" +
          "```\n" +
          `> \`😎\` **Witaj \`${member.user.username}\` na __NEW SHOP!__**\n` +
          `> \`🧑‍🤝‍🧑\` **Jesteś \`${member.guild.memberCount}\` osobą na naszym serwerze!**\n` +
          `> \`✨\` **Liczymy, że zostaniesz z nami na dłużej!**`,
        )
        .setThumbnail(
          member.user.displayAvatarURL({ dynamic: true, size: 256 }),
        )
        .setTimestamp();

      await ch.send({ content: `<@${member.id}>`, embeds: [embed] });
    } else if (member.guild.systemChannel) {
      const embed = new EmbedBuilder()
        .setColor(COLOR_BLUE)
        .setDescription(
          "```\n" +
          "👋 New Shop × LOBBY\n" +
          "```\n" +
          `> \`😎\` **Witaj \`${member.user.username}\` na __NEW SHOP!__**\n` +
          `> \`🧑‍🤝‍🧑\` **Jesteś \`${member.guild.memberCount}\` osobą na naszym serwerze!**\n` +
          `> \`✨\` **Liczymy, że zostaniesz z nami na dłużej!**`,
        )
        .setThumbnail(
          member.user.displayAvatarURL({ dynamic: true, size: 256 }),
        )
        .setTimestamp();

      await member.guild.systemChannel
        .send({ content: `<@${member.id}>`, embeds: [embed] })
        .catch(() => null);
    }
  } catch (err) {
    console.error("Błąd wysyłania powitania / invite tracking:", err);
  }
});

// decrement inviter count on leave if we tracked who invited them
client.on(Events.GuildMemberRemove, async (member) => {
  try {
    const key = `${member.guild.id}:${member.id}`;
    const stored = inviterOfMember.get(key);
    if (!stored) return;

    // backward-compat: jeżeli stary format (string), zamieniamy na obiekt
    let inviterId, counted, wasFake;
    if (typeof stored === "string") {
      inviterId = stored;
      counted = true; // zakładamy, że wcześniej był liczony
      wasFake = false;
    } else {
      inviterId = stored.inviterId;
      counted = !!stored.counted;
      wasFake = !!stored.isFake;
    }

    if (!inviterId) {
      inviterOfMember.delete(key);
      return;
    }

    // decrement inviteCounts for inviter (if present AND if this invite was counted)
    if (!inviteCounts.has(member.guild.id))
      inviteCounts.set(member.guild.id, new Map());
    const gMap = inviteCounts.get(member.guild.id);
    const ownerId = "1305200545979437129";
    
    // Odejmujemy zaproszenia tylko jeśli nie jest właścicielem
    if (counted && inviterId !== ownerId) {
      const prev = gMap.get(inviterId) || 0;
      const newCount = Math.max(0, prev - 1);
      gMap.set(inviterId, newCount);
      inviteCounts.set(member.guild.id, gMap);
      scheduleSavePersistentState(true); // Natychmiastowy zapis
    }

    // decrement totalJoined (since we incremented it on join unconditionally)
    if (!inviteTotalJoined.has(member.guild.id))
      inviteTotalJoined.set(member.guild.id, new Map());
    const totalMap = inviteTotalJoined.get(member.guild.id);
    const prevTotal = totalMap.get(inviterId) || 0;
    totalMap.set(inviterId, Math.max(0, prevTotal - 1));

    // If it was marked as fake on join, decrement fake counter
    if (wasFake) {
      if (!inviteFakeAccounts.has(member.guild.id))
        inviteFakeAccounts.set(member.guild.id, new Map());
      const fMap = inviteFakeAccounts.get(member.guild.id);
      const prevFake = fMap.get(inviterId) || 0;
      fMap.set(inviterId, Math.max(0, prevFake - 1));
    }

    // increment leaves count
    if (!inviteLeaves.has(member.guild.id))
      inviteLeaves.set(member.guild.id, new Map());
    const lMap = inviteLeaves.get(member.guild.id);
    const prevLeft = lMap.get(inviterId) || 0;
    lMap.set(inviterId, prevLeft + 1);
    inviteLeaves.set(member.guild.id, lMap);

    // Zapisz do leaveRecords na wypadek powrotu
    leaveRecords.set(key, inviterId);

    // remove mapping
    inviterOfMember.delete(key);

    // persist invite + leave stan
    scheduleSavePersistentState();

    // notify zaproszenia channel
    const zapCh =
      member.guild.channels.cache.find(
        (c) =>
          c.type === ChannelType.GuildText &&
          (c.name === "📨-×┃zaproszenia" ||
            c.name.toLowerCase().includes("zaproszen") ||
            c.name.toLowerCase().includes("zaproszenia")),
      ) || null;

    if (zapCh) {
      // compute newCount for message (inviteCounts after possible decrement)
      const currentCount = gMap.get(inviterId) || 0;
      const inviteWord = getInviteWord(currentCount);
      const ownerId = "1305200545979437129";
      
      try {
        let message;
        if (inviterId === ownerId) {
          // Opuszczenie przez zaproszenie właściciela - nie odejmowaliśmy zaproszeń
          message = `> \`🚪\` × <@${member.id}> opuścił serwer. (Był zaproszony przez właściciela)`;
        } else {
          // Normalne opuszczenie
          message = `> \`🚪\` × <@${member.id}> opuścił serwer. Był zaproszony przez <@${inviterId}> który ma teraz **${currentCount}** ${inviteWord}.`;
        }
        await zapCh.send(message);
      } catch (e) { }
    }

    console.log(
      `Odejmuję zaproszenie od ${inviterId} po leave (counted=${counted}, wasFake=${wasFake}).`,
    );
  } catch (err) {
    console.error("Błąd przy obsłudze odejścia członka:", err);
  }
});

// ----------------- /sprawdz-zaproszenia command handler -----------------
async function handleSprawdzZaproszeniaCommand(interaction) {
  // Najpierw sprawdzamy warunki bez defer
  if (!interaction.guild) {
    await interaction.reply({
      content: "> `❌` × **Tylko** na **serwerze**.",
      flags: [MessageFlags.Ephemeral]
    });
    return;
  }

  const SPRAWDZ_ZAPROSZENIA_CHANNEL_ID = "1449159417445482566";
  if (interaction.channelId !== SPRAWDZ_ZAPROSZENIA_CHANNEL_ID) {
    await interaction.reply({
      content: "> `❌` × Użyj tej **komendy** na kanale <#1449159417445482566>.",
      flags: [MessageFlags.Ephemeral]
    });
    return;
  }

  // cooldown 30s
  const nowTs = Date.now();
  const lastTs = sprawdzZaproszeniaCooldowns.get(interaction.user.id) || 0;
  if (nowTs - lastTs < 30_000) {
    const remain = Math.ceil((30_000 - (nowTs - lastTs)) / 1000);
    await interaction.reply({
      content: `> \`❌\` × Możesz użyć komendy </sprawdz-zaproszenia:1464015495932940398> ponownie za \`${remain}s\` `,
      flags: [MessageFlags.Ephemeral]
    });
    return;
  }
  sprawdzZaproszeniaCooldowns.set(interaction.user.id, nowTs);

  // Teraz dopiero defer - tymczasowo ephemeral dla potwierdzenia
  await interaction.deferReply({ ephemeral: true }).catch(() => null);

  // ===== SPRAWDZ-ZAPROSZENIA – PEŁNY SCRIPT =====

  const preferChannel = interaction.guild.channels.cache.get(SPRAWDZ_ZAPROSZENIA_CHANNEL_ID);
  const guildId = interaction.guild.id;

  // Inicjalizacja map
  if (!inviteCounts.has(guildId)) inviteCounts.set(guildId, new Map());
  if (!inviteRewards.has(guildId)) inviteRewards.set(guildId, new Map());
  if (!inviteRewardsGiven.has(guildId)) inviteRewardsGiven.set(guildId, new Map());
  if (!inviteLeaves.has(guildId)) inviteLeaves.set(guildId, new Map());
  if (!inviteTotalJoined.has(guildId)) inviteTotalJoined.set(guildId, new Map());
  if (!inviteFakeAccounts.has(guildId)) inviteFakeAccounts.set(guildId, new Map());
  if (!inviteBonusInvites.has(guildId)) inviteBonusInvites.set(guildId, new Map());

  // Mapy gildii
  const gMap = inviteCounts.get(guildId);
  const totalMap = inviteTotalJoined.get(guildId);
  const fakeMap = inviteFakeAccounts.get(guildId);
  const lMap = inviteLeaves.get(guildId);
  const bonusMap = inviteBonusInvites.get(guildId);

  // Dane użytkownika
  const userId = interaction.user.id;
  const validInvites = gMap.get(userId) || 0;
  const left = lMap.get(userId) || 0;
  const fake = fakeMap.get(userId) || 0;
  const bonus = bonusMap.get(userId) || 0;

  // Zaproszenia wyświetlane (z bonusem)
  const displayedInvites = validInvites + bonus;
  const inviteWord = getInviteWord(displayedInvites);

  // Brakujące do nagrody
  let missingToReward = INVITE_REWARD_THRESHOLD - (displayedInvites % INVITE_REWARD_THRESHOLD);
  if (displayedInvites !== 0 && displayedInvites % INVITE_REWARD_THRESHOLD === 0) {
    missingToReward = 0;
  }

  // Embed
  const embed = new EmbedBuilder()
    .setColor(COLOR_BLUE)
    .setDescription(
          "```\n" +
          "📩 New Shop × ZAPROSZENIA\n" +
          "```\n" +
      `> \`👤\` × <@${userId}> **posiada:** \`${displayedInvites}\` **${inviteWord}**!\n` +
      `> \`💸\` × **Brakuje ci zaproszeń do nagrody ${INVITE_REWARD_TEXT}:** \`${missingToReward}\`\n\n` +
      `> \`👥\` × **Prawdziwe osoby które dołączyły:** \`${displayedInvites}\`\n` +
      `> \`🚶\` × **Osoby które opuściły serwer:** \`${left}\`\n` +
      `> \`⚠️\` × **Niespełniające kryteriów (< konto 2 mies.):** \`${fake}\`\n` +
      `> \`🎁\` × **Dodatkowe zaproszenia:** \`${bonus}\``
    );

  try {
    // Kanał docelowy
    const targetChannel = preferChannel ? preferChannel : interaction.channel;

    // Publikacja embeda
    await targetChannel.send({ embeds: [embed] });

    // Odświeżanie instrukcji
    try {
      const zapCh = targetChannel;
      if (zapCh && zapCh.id) {
        const prevId = lastInviteInstruction.get(zapCh.id);
        if (prevId) {
          const prevMsg = await zapCh.messages.fetch(prevId).catch(() => null);
          if (prevMsg && prevMsg.deletable) {
            await prevMsg.delete().catch(() => null);
          }
          lastInviteInstruction.delete(zapCh.id);
        }

        const instructionInviteEmbed = new EmbedBuilder()
          .setColor(0xffffff)
          .setDescription(
            "`📩` × Użyj **komendy** </sprawdz-zaproszenia:1464015495932940398>, aby sprawdzić swoje **zaproszenia**"
          );

        const sent = await zapCh.send({ embeds: [instructionInviteEmbed] });
        lastInviteInstruction.set(zapCh.id, sent.id);
        scheduleSavePersistentState();
      }
    } catch (e) {
      console.warn("Nie udało się odświeżyć instrukcji zaproszeń:", e);
    }

    await interaction.editReply({
      content: "> \`✅\` × Informacje o twoich **zaproszeniach** zostały wysłane."
    });

  } catch (err) {
    console.error("Błąd przy publikacji sprawdz-zaproszenia:", err);
    try {
      await interaction.editReply({ embeds: [embed] });
    } catch {
      await interaction.editReply({
        content: "> \`❌\` × Nie udało się opublikować informacji o **zaproszeniach**."
      });
    }
  }
}

// ---------------------------------------------------
// Nowa komenda: /zaproszeniastats
async function handleZaprosieniaStatsCommand(interaction) {
  if (!interaction.guild) {
    await interaction.reply({
      content: "> `❌` × **Ta komenda** działa tylko na **serwerze**.",
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // Sprawdź czy właściciel
  if (interaction.user.id !== interaction.guild.ownerId) {
    await interaction.reply({
      content: "> `❗` × Brak wymaganych uprawnień.",
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const categoryRaw = (
    interaction.options.getString("kategoria") || ""
  ).toLowerCase();
  const action = (interaction.options.getString("akcja") || "").toLowerCase();
  const number = Math.max(0, interaction.options.getInteger("liczba") || 0);
  const user = interaction.options.getUser("komu") || interaction.user;
  const guildId = interaction.guild.id;

  // normalize category aliases
  let category = null;
  if (["prawdziwe", "prawdziwy", "prawdzi"].includes(categoryRaw))
    category = "prawdziwe";
  else if (
    ["opuszczone", "opuśćone", "opuszcone", "left", "lefts"].includes(
      categoryRaw,
    )
  )
    category = "opuszczone";
  else if (
    [
      "mniej4mies",
      "mniejniż4mies",
      "mniej_niz_4mies",
      "mniej",
      "mniej4",
    ].includes(categoryRaw)
  )
    category = "mniej4mies";
  else if (["dodatkowe", "dodatkowa", "bonus", "bonusy"].includes(categoryRaw))
    category = "dodatkowe";

  if (!category) {
    await interaction.reply({
      content: "> ❌ × **Nieznana** kategoria. Wybierz: `prawdziwe`, `opuszczone`, `mniej4mies`, `dodatkowe`.",
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // ensure maps exist
  if (!inviteCounts.has(guildId)) inviteCounts.set(guildId, new Map());
  if (!inviteLeaves.has(guildId)) inviteLeaves.set(guildId, new Map());
  if (!inviteFakeAccounts.has(guildId))
    inviteFakeAccounts.set(guildId, new Map());
  if (!inviteBonusInvites.has(guildId))
    inviteBonusInvites.set(guildId, new Map());
  if (!inviteRewards.has(guildId)) inviteRewards.set(guildId, new Map());
  if (!inviteRewardsGiven.has(guildId))
    inviteRewardsGiven.set(guildId, new Map());

  let targetMap;
  let prettyName;
  switch (category) {
    case "prawdziwe":
      targetMap = inviteCounts.get(guildId);
      prettyName = "Prawdziwe (policzone) zaproszenia";
      break;
    case "opuszczone":
      targetMap = inviteLeaves.get(guildId);
      prettyName = "Osoby, które opuściły serwer";
      break;
    case "mniej4mies":
      targetMap = inviteFakeAccounts.get(guildId);
      prettyName = "Niespełniające kryteriów (< konto 4 mies.)";
      break;
    case "dodatkowe":
      targetMap = inviteBonusInvites.get(guildId);
      prettyName = "Dodatkowe zaproszenia";
      break;
    default:
      targetMap = inviteCounts.get(guildId);
      prettyName = category;
  }

  const prev = targetMap.get(user.id) || 0;
  let newVal = prev;

  if (action === "dodaj") {
    newVal = prev + number;
  } else if (action === "odejmij") {
    newVal = Math.max(0, prev - number);
  } else if (action === "ustaw") {
    newVal = Math.max(0, number);
  } else if (action === "wyczysc" || action === "czysc" || action === "reset") {
    newVal = 0;
  } else {
    await interaction.reply({
      content:
        "❌ Nieznana akcja. Wybierz: `dodaj`, `odejmij`, `ustaw`, `wyczysc`.",
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // BEFORE saving: jeśli edytujemy "prawdziwe", sprawdź czy osiągnięto próg i przyznaj nagrody
  if (category === "prawdziwe") {
    // Inicjalizacja mapy reward levels dla tego guilda
    if (!inviteRewardLevels.has(guildId)) {
      inviteRewardLevels.set(guildId, new Map());
    }
    const rewardLevelsMap = inviteRewardLevels.get(guildId);
    
    // Inicjalizacja setu dla tego użytkownika
    if (!rewardLevelsMap.has(user.id)) {
      rewardLevelsMap.set(user.id, new Set());
    }
    const userRewardLevels = rewardLevelsMap.get(user.id);
    
    // Sprawdź jakie progi zostały osiągnięte (5, 10, 15, 20...)
    const achievedLevels = [];
    for (let level = 5; level <= newVal; level += 5) {
      if (newVal >= level && !userRewardLevels.has(level.toString())) {
        achievedLevels.push(level);
      }
    }
    
    // Przyznaj nagrody za nowe progi
    if (achievedLevels.length > 0) {
      const rMap = inviteRewards.get(guildId) || new Map();
      inviteRewards.set(guildId, rMap);

      const generatedCodes = [];

      for (const level of achievedLevels) {
        const rewardCode = generateCode();
        const CODE_EXPIRES_MS = 24 * 60 * 60 * 1000;
        const expiresAt = Date.now() + CODE_EXPIRES_MS;

        activeCodes.set(rewardCode, {
          oderId: user.id,
          discount: 0,
          expiresAt,
          used: false,
          reward: INVITE_REWARD_TEXT,
          type: "invite_reward",
        });

        // Zapisz do Supabase
        await db.saveActiveCode(rewardCode, {
          oderId: user.id,
          discount: 0,
          expiresAt,
          used: false,
          reward: INVITE_REWARD_TEXT,
          type: "invite_reward"
        });

        generatedCodes.push(rewardCode);
        // Oznacz ten próg jako odebrany
        userRewardLevels.add(level.toString());
        console.log(`[rewards] Użytkownik ${user.id} otrzymał nagrodę za próg ${level} zaproszeń`);
      }

      // Zaktualizuj liczbę przyznanych nagród (stary system dla kompatybilności)
      const rewardsGivenMap = inviteRewardsGiven.get(guildId) || new Map();
      const alreadyGiven = rewardsGivenMap.get(user.id) || 0;
      rewardsGivenMap.set(user.id, alreadyGiven + achievedLevels.length);
      inviteRewardsGiven.set(guildId, rewardsGivenMap);

      // Przygotuj kanał zaproszeń
      const zapCh =
        interaction.guild.channels.cache.find(
          (c) =>
            c.type === ChannelType.GuildText &&
            (c.name === "📨-×┃zaproszenia" ||
              c.name.toLowerCase().includes("zaproszen") ||
              c.name.toLowerCase().includes("zaproszenia")),
        ) || null;

      // Wyślij DM z kodami
      try {
        const u = await client.users.fetch(user.id);
        const codesList = generatedCodes.join("\n");
        const expiresAtSeconds = Math.floor(
          (Date.now() + 24 * 60 * 60 * 1000) / 1000,
        );

        const dmEmbed = new EmbedBuilder()
          .setColor(0xd4af37)
          .setTitle("\`🔑\` Twój kod za zaproszenia")
          .setDescription(
            "```\n" +
            codesList +
            "\n```\n" +
            `> \`💸\` × **Otrzymałeś:** \`${INVITE_REWARD_TEXT}\`\n` +
            `> \`🕑\` × **Kod wygaśnie za:** <t:${expiresAtSeconds}:R> \n\n` +
            `> \`❔\` × Aby zrealizować kod utwórz nowy ticket, wybierz kategorię\n` +
            `> \`Odbiór nagrody\` i w polu wpisz otrzymany kod.`,
          )
          .setTimestamp();

        await u.send({ embeds: [dmEmbed] }).catch(async () => {
          // Jeśli DM się nie udało, nie wysyłamy kodów na kanał
          console.error("Nie udało się wysłać DM z nagrodą do użytkownika", user.id);
        });

        // Powiadomienie publiczne
      } catch (e) {
        console.error("Błąd wysyłania DM z nagrodą:", e);
      }
    }
  }

  // finally set the (possibly adjusted) value
  targetMap.set(user.id, newVal);
  scheduleSavePersistentState();

  await interaction.reply({
    content: `✅ Zaktualizowano **${prettyName}** dla <@${user.id}>: \`${prev}\` → \`${newVal}\`.`,
    flags: [MessageFlags.Ephemeral],
  });
}

// ---------------------------------------------------
// Pomoc
async function handleHelpCommand(interaction) {
  try {
    const embed = new EmbedBuilder()
      .setColor(COLOR_BLUE)
      .setTitle("\`📋\` × Spis komend")
      .setDescription(
        [
          "**`Komendy ogólne:`**",
          "> \`🎁\` × </drop:1464015494876102748> Wylosuj zniżke na zakupy!",
          "> \`📩\` × </sprawdz-zaproszenia:1464015495932940398> Sprawdź swoje zaproszenia",
          "> \`⭐\` × </opinia:1464015495392133321> Podziel się opinią o naszym sklepie",
          "> \`📋\` × </help:1464015495392133316> — Pokaż tę wiadomość",
        ].join("\n"),
      )

    // reply ephemeral so tylko użytkownik widzi
    await interaction.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
  } catch (err) {
    console.error("handleHelpCommand error:", err);
    try {
      await interaction.reply({
        content: "> `❌` × **Błąd** podczas wyświetlania **pomocy**.",
        flags: [MessageFlags.Ephemeral],
      });
    } catch (e) { }
  }
}

// Parser czasu: 1h = 1 godzina, 1d = 1 dzień, 1m = 1 minuta, 1s = 1 sekunda
function parseTimeString(timeStr) {
  if (!timeStr || typeof timeStr !== "string") return null;
  const trimmed = timeStr.trim().toLowerCase();
  const match = trimmed.match(/^(\d+)([hdms])$/);
  if (!match) return null;
  const value = parseInt(match[1], 10);
  const unit = match[2];
  if (isNaN(value) || value <= 0) return null;

  switch (unit) {
    case "s":
      return value * 1000; // sekundy -> ms
    case "m":
      return value * 60 * 1000; // minuty -> ms
    case "h":
      return value * 60 * 60 * 1000; // godziny -> ms
    case "d":
      return value * 24 * 60 * 60 * 1000; // dni -> ms
    default:
      return null;
  }
}

// --- Pomocnicze: formatowanie pozostałego czasu ---
function formatTimeDelta(ms) {
  const timestamp = Math.floor((Date.now() + ms) / 1000);
  return `<t:${timestamp}:R>`;
}

// --- Pomocnicze: formatowanie czasu blokady ---
function formatBlockTime(remainingMs) {
  const totalSeconds = Math.floor(remainingMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  
  if (hours > 0) {
    return `${hours} godzin ${minutes} minut ${seconds} sekund`;
  } else if (minutes > 0) {
    return `${minutes} minut ${seconds} sekund`;
  } else {
    return `${seconds} sekund`;
  }
}

// --- Pomocnicze: poprawna forma liczby osób ---
function getPersonForm(count) {
  if (count === 1) return "osoba";
  if (
    count % 10 >= 2 &&
    count % 10 <= 4 &&
    (count % 100 < 10 || count % 100 >= 20)
  ) {
    return "osoby";
  }
  return "osób";
}

// --- Pomocnicze: losowanie zwycięzców ---
function pickRandom(arr, n) {
  if (!arr || !arr.length) return [];
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

// ----------------- /dodajkonkurs handler (poprawiona wersja) -----------------
async function handleDodajKonkursCommand(interaction) {
  if (!interaction.guild) {
    await interaction.reply({
      content: "> `❌` × **Tylko** na **serwerze**.",
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }
  // Sprawdź czy właściciel
  if (interaction.user.id !== interaction.guild.ownerId) {
    await interaction.reply({
      content: "> `❗` × Brak wymaganych uprawnień.",
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // Modal: tylko nagroda (jako tytuł), czas, zwycięzcy i wymagane zaproszenia
  const modal = new ModalBuilder()
    .setCustomId("konkurs_create_modal")
    .setTitle("Utwórz konkurs");

  const prizeInput = new TextInputBuilder()
    .setCustomId("konkurs_nagroda")
    .setLabel("Nagroda (to będzie tytuł konkursu)")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(200);

  const timeInput = new TextInputBuilder()
    .setCustomId("konkurs_czas")
    .setLabel("Czas trwania (np. 1h, 2d, 30m, 60s)")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder("h = godzina, m = minuta, d = dzień, s = sekunda")
    .setMaxLength(10);

  const winnersInput = new TextInputBuilder()
    .setCustomId("konkurs_zwyciezcy")
    .setLabel("Liczba zwycięzców")
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setPlaceholder("1")
    .setMaxLength(3);

  const invitesReqInput = new TextInputBuilder()
    .setCustomId("konkurs_wymagania_zaproszenia")
    .setLabel("Wymagane zaproszenia (opcjonalnie)")
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setPlaceholder("2")
    .setMaxLength(5);

  modal.addComponents(
    new ActionRowBuilder().addComponents(prizeInput),
    new ActionRowBuilder().addComponents(timeInput),
    new ActionRowBuilder().addComponents(winnersInput),
    new ActionRowBuilder().addComponents(invitesReqInput),
  );

  await interaction.showModal(modal);
}

async function handleKonkursCreateModal(interaction) {
  const prize = interaction.fields.getTextInputValue("konkurs_nagroda");
  const timeStr = interaction.fields.getTextInputValue("konkurs_czas");
  const winnersStr =
    interaction.fields.getTextInputValue("konkurs_zwyciezcy") || "1";
  const invitesReqStr =
    interaction.fields.getTextInputValue("konkurs_wymagania_zaproszenia") || "";

  const timeMs = parseTimeString(timeStr);
  if (!timeMs) {
    await interaction.reply({
      content:
        "❌ Nieprawidłowy format czasu. Użyj np. `1h`, `2d`, `30m`, `60s`",
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const winnersCount = Math.max(1, parseInt(winnersStr, 10) || 1);
  const invitesRequired = invitesReqStr.trim()
    ? Math.max(0, parseInt(invitesReqStr.trim(), 10) || 0)
    : 0;

  let targetChannel = interaction.channel;
  await interaction.deferReply({ flags: [MessageFlags.Ephemeral] }).catch(() => { });

  const endsAt = Date.now() + timeMs;
  const ts = Math.floor(endsAt / 1000);

  // Początkowy opis z wymaganiami zaproszeń jeśli są
  let description =
    `🎁 **•** Nagroda: **${prize}**\n\n` +
    `🕐 **•** Koniec konkursu: ${formatTimeDelta(timeMs)}\n` +
    `👑 **•** Liczba zwycięzców: **${winnersCount}**\n` +
    `👥 **•** Liczba uczestników: **0**`;

  if (invitesRequired > 0) {
    const inviteForm = getPersonForm(invitesRequired);
    description += `\n\n⚠️ Wymagane: dodać ${invitesRequired} ${inviteForm} na serwer`;
  }

  // Początkowy embed - 🎉 New Shop × KONKURS w czarnym kwadracie
  const embed = new EmbedBuilder()
    .setDescription(
      "```\n" +
      "🎉 New Shop × KONKURS\n" +
      "```\n" +
      description
    )
    .setColor(COLOR_BLUE)
    .setTimestamp();

  // Placeholder button (will be replaced with proper customId after message is sent)
  const joinBtn = new ButtonBuilder()
    .setCustomId("konkurs_join_pending")
    .setLabel("Weź udział (0)")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(false);

  let sent = null;

  // Dodaj GIF przy tworzeniu konkursu
  try {
    const gifPath = path.join(
      __dirname,
      "attached_assets",
      "standard (4).gif",
    );
    const attachment = new AttachmentBuilder(gifPath, { name: "konkurs_start.gif" });
    embed.setImage("attachment://konkurs_start.gif");
    
    const row = new ActionRowBuilder().addComponents(joinBtn);
    sent = await targetChannel.send({ 
      embeds: [embed], 
      components: [row],
      files: [attachment]
    });
  } catch (err) {
    console.warn("Nie udało się załadować GIFa przy tworzeniu konkursu:", err);
    // Fallback: wyślij bez GIFa
    const row = new ActionRowBuilder().addComponents(joinBtn);
    sent = await targetChannel.send({ 
      embeds: [embed], 
      components: [row]
    });
  }

  if (!sent) {
    try {
      await interaction.editReply({
        content: "> `❌` × **Nie udało się** utworzyć konkursu (nie wysłano wiadomości w **kanał**).",
      });
    } catch (e) {
      // ignore
    }
    return;
  }

  contests.set(sent.id, {
    channelId: targetChannel.id,
    endsAt,
    winnersCount,
    title: prize,
    prize,
    messageId: sent.id,
    createdBy: interaction.user.id,
    invitesRequired,
  });

  contestParticipants.set(sent.id, new Map());
  scheduleSavePersistentState();

  // ustawiamy poprawny id na przycisku już po wysłaniu
  const properCustomId = `konkurs_join_${sent.id}`;
  const joinButtonCorrect = new ButtonBuilder()
    .setCustomId(properCustomId)
    .setLabel("Weź udział (0)")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(false);

  const newRow = new ActionRowBuilder().addComponents(joinButtonCorrect);
  await sent.edit({ components: [newRow] }).catch(() => null);

  setTimeout(() => {
    endContestByMessageId(sent.id).catch((e) => console.error(e));
  }, timeMs);

  try {
    await interaction.editReply({
      content: `\`✅\` Konkurs opublikowany w <#${targetChannel.id}> i potrwa ${formatTimeDelta(timeMs)} (do <t:${ts}:R>)`,
    });
  } catch (err) {
    console.error("Błąd tworzenia konkursu:", err);
    try {
      await interaction.editReply({
        content: "> `❌` × **Nie udało się** utworzyć **konkursu**.",
      });
    } catch (e) {
      console.error("Nie udało się wysłać editReply po błędzie:", e);
    }
  }
}

// ----------------- /dodajkonkurs handler (poprawiona wersja) -----------------
async function handleDodajKonkursCommand(interaction) {
  if (!interaction.guild) {
    await interaction.reply({
      content: "> `❌` × **Tylko** na **serwerze**.",
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }
  // Sprawdź czy właściciel
  if (interaction.user.id !== interaction.guild.ownerId) {
    await interaction.reply({
      content: "> `❗` × Brak wymaganych uprawnień.",
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // Modal: tylko nagroda (jako tytuł), czas, zwycięzcy i wymagane zaproszenia
  const modal = new ModalBuilder()
    .setCustomId("konkurs_create_modal")
    .setTitle("Utwórz konkurs");

  const prizeInput = new TextInputBuilder()
    .setCustomId("konkurs_nagroda")
    .setLabel("Nagroda (to będzie tytuł konkursu)")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(200);

  const timeInput = new TextInputBuilder()
    .setCustomId("konkurs_czas")
    .setLabel("Czas trwania (np. 1h, 2d, 30m, 60s)")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder("h = godzina, m = minuta, d = dzień, s = sekunda")
    .setMaxLength(10);

  const winnersInput = new TextInputBuilder()
    .setCustomId("konkurs_zwyciezcy")
    .setLabel("Liczba zwycięzców")
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setPlaceholder("1")
    .setMaxLength(3);

  const invitesReqInput = new TextInputBuilder()
    .setCustomId("konkurs_wymagania_zaproszenia")
    .setLabel("Wymagane zaproszenia (opcjonalnie)")
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setPlaceholder("2")
    .setMaxLength(5);

  modal.addComponents(
    new ActionRowBuilder().addComponents(prizeInput),
    new ActionRowBuilder().addComponents(timeInput),
    new ActionRowBuilder().addComponents(winnersInput),
    new ActionRowBuilder().addComponents(invitesReqInput),
  );

  await interaction.showModal(modal);
}

async function handleKonkursCreateModal(interaction) {
  const prize = interaction.fields.getTextInputValue("konkurs_nagroda");
  const timeStr = interaction.fields.getTextInputValue("konkurs_czas");
  const winnersStr =
    interaction.fields.getTextInputValue("konkurs_zwyciezcy") || "1";
  const invitesReqStr =
    interaction.fields.getTextInputValue("konkurs_wymagania_zaproszenia") || "";

  const timeMs = parseTimeString(timeStr);
  if (!timeMs) {
    await interaction.reply({
      content:
        "❌ Nieprawidłowy format czasu. Użyj np. `1h`, `2d`, `30m`, `60s`",
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const winnersCount = Math.max(1, parseInt(winnersStr, 10) || 1);
  const invitesRequired = invitesReqStr.trim()
    ? Math.max(0, parseInt(invitesReqStr.trim(), 10) || 0)
    : 0;

  let targetChannel = interaction.channel;
  await interaction.deferReply({ flags: [MessageFlags.Ephemeral] }).catch(() => { });

  const endsAt = Date.now() + timeMs;
  const ts = Math.floor(endsAt / 1000);

  // Początkowy opis z wymaganiami zaproszeń jeśli są
  let description =
    `🎁 **•** Nagroda: **${prize}**\n\n` +
    `🕐 **•** Koniec konkursu: ${formatTimeDelta(timeMs)}\n` +
    `👑 **•** Liczba zwycięzców: **${winnersCount}**\n` +
    `👥 **•** Liczba uczestników: **0**`;

  if (invitesRequired > 0) {
    const inviteForm = getPersonForm(invitesRequired);
    description += `\n\n \`❗\` **Wymagane: dodać ${invitesRequired} ${inviteForm} na serwer**`;
  }

  // Początkowy embed - 🎉 New Shop × KONKURS w czarnym kwadracie
  const embed = new EmbedBuilder()
    .setDescription(
      "```\n" +
      "🎉 New Shop × KONKURS\n" +
      "```\n" +
      description
    )
    .setColor(COLOR_BLUE)
    .setTimestamp();

  // Placeholder button (will be replaced with proper customId after message is sent)
  const joinBtn = new ButtonBuilder()
    .setCustomId("konkurs_join_pending")
    .setLabel("Weź udział (0)")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(false);

  let sent = null;

  // Dodaj GIF przy tworzeniu konkursu
  try {
    const gifPath = path.join(
      __dirname,
      "attached_assets",
      "standard (4).gif",
    );
    const attachment = new AttachmentBuilder(gifPath, { name: "konkurs_start.gif" });
    embed.setImage("attachment://konkurs_start.gif");
    
    const row = new ActionRowBuilder().addComponents(joinBtn);
    sent = await targetChannel.send({ 
      embeds: [embed], 
      components: [row],
      files: [attachment]
    });
  } catch (err) {
    console.warn("Nie udało się załadować GIFa przy tworzeniu konkursu:", err);
    // Fallback: wyślij bez GIFa
    const row = new ActionRowBuilder().addComponents(joinBtn);
    sent = await targetChannel.send({ 
      embeds: [embed], 
      components: [row]
    });
  }

  if (!sent) {
    try {
      await interaction.editReply({
        content: "> `❌` × **Nie udało się** utworzyć konkursu (nie wysłano wiadomości w **kanał**).",
      });
    } catch (e) {
      // ignore
    }
    return;
  }

  contests.set(sent.id, {
    channelId: targetChannel.id,
    endsAt,
    winnersCount,
    title: prize,
    prize,
    messageId: sent.id,
    createdBy: interaction.user.id,
    invitesRequired,
  });

  contestParticipants.set(sent.id, new Map());
  scheduleSavePersistentState();

  // ustawiamy poprawny id na przycisku już po wysłaniu
  const properCustomId = `konkurs_join_${sent.id}`;
  const joinButtonCorrect = new ButtonBuilder()
    .setCustomId(properCustomId)
    .setLabel("Weź udział (0)")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(false);

  const newRow = new ActionRowBuilder().addComponents(joinButtonCorrect);
  await sent.edit({ components: [newRow] }).catch(() => null);

  setTimeout(() => {
    endContestByMessageId(sent.id).catch((e) => console.error(e));
  }, timeMs);

  try {
    await interaction.editReply({
      content: `\`✅\` Konkurs opublikowany w <#${targetChannel.id}> i potrwa ${formatTimeDelta(timeMs)} (do <t:${ts}:R>)`,
    });
  } catch (err) {
    console.error("Błąd tworzenia konkursu:", err);
    try {
      await interaction.editReply({
        content: "> `❌` × **Nie udało się** utworzyć **konkursu**.",
      });
    } catch (e) {
      console.error("Nie udało się wysłać editReply po błędzie:", e);
    }
  }
}

async function handleKonkursJoinModal(interaction, msgId) {
  const contest = contests.get(msgId);
  if (!contest) {
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLOR_BLUE)
          .setDescription("> `❌` × **Konkurs** nie został znaleziony.")
          .setTimestamp(),
      ],
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }
  if (Date.now() >= contest.endsAt) {
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLOR_BLUE)
          .setDescription("> `❌` × **Konkurs** już się zakończył.")
          .setTimestamp(),
      ],
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  if (contest.invitesRequired > 0) {
    const gMap = inviteCounts.get(interaction.guild.id) || new Map();
    const userInvites = gMap.get(interaction.user.id) || 0;
    if (userInvites < contest.invitesRequired) {
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLOR_BLUE)
            .setDescription(
              `❌ Nie masz wystarczającej liczby zaproszeń. Wymagane: ${contest.invitesRequired}`,
            )
            .setTimestamp(),
        ],
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }
  }

  let nick = "";
  try {
    nick = (interaction.fields.getTextInputValue("konkurs_nick") || "").trim();
  } catch (e) {
    nick = "";
  }

  let participantsMap = contestParticipants.get(msgId);
  if (!participantsMap) {
    participantsMap = new Map();
    contestParticipants.set(msgId, participantsMap);
  }

  const userId = interaction.user.id;
  if (participantsMap.has(userId)) {
    // Użytkownik już jest zapisany - pytaj czy chce opuścić
    const leaveBtn = new ButtonBuilder()
      .setCustomId(`confirm_leave_${msgId}`)
      .setLabel("Opuść Konkurs")
      .setStyle(ButtonStyle.Danger);

    const cancelBtn = new ButtonBuilder()
      .setCustomId(`cancel_leave_${msgId}`)
      .setLabel("Anuluj")
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder().addComponents(leaveBtn, cancelBtn);

    const questionEmbed = new EmbedBuilder()
      .setColor(COLOR_BLUE)
      .setDescription("> \`❓\` × Już wziąłeś udział w tym konkursie!");

    await interaction.reply({
      embeds: [questionEmbed],
      components: [row],
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  participantsMap.set(userId, nick);
  scheduleSavePersistentState();

  // Resetuj licznik wyjść gdy użytkownik ponownie dołącza do konkursu
  const userBlocks = contestLeaveBlocks.get(userId) || {};
  if (userBlocks[msgId]) {
    userBlocks[msgId].leaveCount = 0;
    userBlocks[msgId].blockedUntil = 0;
    contestLeaveBlocks.set(userId, userBlocks);
    scheduleSavePersistentState();
  }

  const participantsCount = participantsMap.size;

  // Aktualizuj wiadomość konkursu
  try {
    const ch = await client.channels.fetch(contest.channelId).catch(() => null);
    if (ch) {
      const origMsg = await ch.messages.fetch(msgId).catch(() => null);
      if (origMsg) {
        // Zaktualizuj opis
        let updatedDescription =
          `🎁 **•** Nagroda: **${contest.prize}**\n\n` +
          `🕐 **•** Koniec konkursu: ${formatTimeDelta(contest.endsAt - Date.now())}\n` +
          `👑 **•** Liczba zwycięzców: **${contest.winnersCount}**\n` +
          `👥 **•** Liczba uczestników: **${participantsCount}**`;
        
        

        if (contest.invitesRequired > 0) {
          const inviteForm = getPersonForm(contest.invitesRequired);
          updatedDescription += `\n\n⚠️ Wymagane: dodać ${contest.invitesRequired} ${inviteForm} na serwer`;
        }

        // Pobierz istniejący embed i zachowaj czarny kwadrat
        const existingEmbed = EmbedBuilder.from(origMsg.embeds[0]);
        const originalDescription = existingEmbed.data.description || '';
        
        // Wyodrębnij czarny kwadrat z oryginalnego opisu
        const blackBoxMatch = originalDescription.match(/```[\s\S]*?```/);
        const blackBox = blackBoxMatch ? blackBoxMatch[0] : '';
        
        // Połącz czarny kwadrat z nowym opisem
        const fullDescription = blackBox + '\n' + updatedDescription;
        existingEmbed.setDescription(fullDescription);

        // Zaktualizuj przycisk
        const joinButton = new ButtonBuilder()
          .setCustomId(`konkurs_join_${msgId}`)
          .setLabel(`Weź udział (${participantsCount})`)
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(false);
        const row = new ActionRowBuilder().addComponents(joinButton);

        // Edytuj wiadomość - usuń stare załączniki i dodaj ten sam GIF ponownie
        try {
          const gifPath = path.join(
            __dirname,
            "attached_assets",
            "standard (4).gif",
          );
          const attachment = new AttachmentBuilder(gifPath, { name: "konkurs_start.gif" });
          existingEmbed.setImage("attachment://konkurs_start.gif");
          
          await origMsg.edit({ 
            embeds: [existingEmbed], 
            components: [row],
            files: [attachment]
          }).catch(() => null);
        } catch (err) {
          console.warn("Nie udało się załadować GIFa przy edycji konkursu:", err);
          // Fallback: usuń załączniki bez GIFa
          await origMsg.edit({ 
            embeds: [existingEmbed], 
            components: [row],
            attachments: []
          }).catch(() => null);
        }
      }
    }
  } catch (e) {
    console.warn("Nie udało się zaktualizować embed/btn konkursu:", e);
  }

  // Prosta odpowiedź dla nowego uczestnika
  const joinEmbed = new EmbedBuilder()
    .setColor(COLOR_BLUE)
    .setDescription("> \`✅\` × Poprawnie dołączyłeś do konkursu.");

  await interaction.reply({
    embeds: [joinEmbed],
    flags: [MessageFlags.Ephemeral],
  });
}

async function endContestByMessageId(messageId) {
  const meta = contests.get(messageId);
  if (!meta) return;
  const channel = await client.channels.fetch(meta.channelId).catch(() => null);
  if (!channel) return;

  const participantsMap = contestParticipants.get(messageId) || new Map();
  const participants = Array.from(participantsMap.entries());

  const winnersCount = Math.min(meta.winnersCount || 1, participants.length);
  const winners = pickRandom(participants, winnersCount);

  // logi-konkurs
  const logiKonkursChannelId = "1451666381937578004";
  let logChannel = null;
  try {
    logChannel = await channel.guild.channels
      .fetch(logiKonkursChannelId)
      .catch(() => null);
  } catch (e) {
    logChannel = null;
  }

  let winnersDetails = "";
  if (winners.length > 0) {
    winnersDetails = winners
      .map(
        ([userId, nick], i) =>
          `\`${i + 1}.\` <@${userId}> (MC: ${nick || "brak"})`,
      )
      .join("\n");
  } else {
    winnersDetails = "Brak zwycięzców";
  }

  const podsumowanieEmbed = new EmbedBuilder()
    .setColor(COLOR_BLUE)
    .setDescription(
       "```\n" +
      "🎉 Konkurs zakończony 🎉\n" +
       "```\n" +
      `**🎁 **•** Nagroda:** ${meta.prize}\n\n` +
      `**🏆 **•** Zwycięzcy:**\n${winnersDetails}`,
    )
    .setTimestamp();

  if (logChannel) {
    try {
      await logChannel.send({ embeds: [podsumowanieEmbed] });
    } catch (e) {
      console.warn("Nie udało się wysłać do logi-konkurs:", e);
    }
  }

  // Edytuj wiadomość konkursową — EMBED z wynikami + przycisk podsumowujący
  try {
    const origMsg = await channel.messages.fetch(messageId).catch(() => null);
    if (origMsg) {
      // embed końcowy
      const publicWinners =
        winners.length > 0
          ? winners.map(([userId]) => `<@${userId}>`).join("\n")
          : "Brak zwycięzców";

      const finalEmbed = new EmbedBuilder()
        .setColor(COLOR_BLUE)
        .setDescription(
           "```\n" +
          "🎉 Konkurs zakończony 🎉\n" +
           "```\n" +
          `**🎁 **•** Nagroda:** ${meta.prize}\n\n` +
          `**🏆 **•** Zwycięzcy:**\n${publicWinners}`,
        )
        .setTimestamp()
        .setImage("attachment://konkurs_end.gif");

      const personForm = getPersonForm(participants.length);
      let buttonLabel;
      if (participants.length === 1) {
        buttonLabel = `Wzięła udział 1 osoba`;
      } else if (
        participants.length % 10 >= 2 &&
        participants.length % 10 <= 4 &&
        (participants.length % 100 < 10 || participants.length % 100 >= 20)
      ) {
        buttonLabel = `Wzięły udział ${participants.length} ${personForm}`;
      } else {
        buttonLabel = `Wzięło udział ${participants.length} ${personForm}`;
      }

      const joinButton = new ButtonBuilder()
        .setCustomId(`konkurs_join_${messageId}`)
        .setLabel(buttonLabel)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true);

      const row = new ActionRowBuilder().addComponents(joinButton);

      // Dodaj GIF na zakończenie konkursu
      try {
        const gifPath = path.join(
          __dirname,
          "attached_assets",
          "standard (3).gif",
        );
        const attachment = new AttachmentBuilder(gifPath, { name: "konkurs_end.gif" });
        await origMsg
          .edit({ embeds: [finalEmbed], components: [row], files: [attachment] })
          .catch(() => null);
      } catch (err) {
        console.warn("Nie udało się załadować GIFa na zakończenie konkursu:", err);
        try {
          finalEmbed.setImage(null);
        } catch (e) {
          // ignore
        }
        await origMsg
          .edit({ embeds: [finalEmbed], components: [row], attachments: [] })
          .catch(() => null);
      }
    }
  } catch (err) {
    console.warn("Nie udało się zedytować wiadomości konkursu na końcu:", err);
  }

  contests.delete(messageId);
  contestParticipants.delete(messageId);
  scheduleSavePersistentState();
}

// --- Obsługa /end-giveaways ---
async function handleEndGiveawaysCommand(interaction) {
  // Sprawdź czy właściciel serwera
  const isOwner = interaction.user.id === interaction.guild.ownerId;
  if (!isOwner) {
    await interaction.reply({
      content: "> `❌` × **Tylko właściciel serwera** może użyć tej komendy.",
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  if (!interaction.guild) {
    await interaction.reply({
      content: "> `❌` × **Tylko** na **serwerze**.",
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const now = Date.now();
  const activeContests = Array.from(contests.entries()).filter(([_, meta]) => meta.endsAt > now);
  
  if (activeContests.length === 0) {
    await interaction.reply({
      content: "> `ℹ️` × **Brak aktywnych konkursów** do zakończenia.",
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // Zakończ wszystkie aktywne konkursy
  const endedContests = [];
  const failedContests = [];

  for (const [messageId, meta] of activeContests) {
    try {
      await endContestByMessageId(messageId);
      const timeLeft = meta.endsAt - now;
      endedContests.push({
        prize: meta.prize,
        timeLeft: humanizeMs(timeLeft),
        channelId: meta.channelId,
        messageId: messageId,
      });
    } catch (error) {
      console.error(`Błąd podczas kończenia konkursu ${messageId}:`, error);
      failedContests.push({
        prize: meta.prize,
        error: error.message,
      });
    }
  }

  // Stwórz embed z podsumowaniem
  const summaryEmbed = new EmbedBuilder()
    .setColor(endedContests.length > 0 ? COLOR_BLUE : COLOR_RED)
    .setTitle("🏁 Zakończono wszystkie konkursy")
    .setTimestamp()
    .setFooter({ text: `Wykonane przez: ${interaction.user.tag}` });

  let description = "";
  
  if (endedContests.length > 0) {
    description += `## \`✅\` Pomyślnie zakończone konkursy (${endedContests.length}):\n\n`;
    endedContests.forEach((contest, index) => {
      description += `**${index + 1}. ${contest.prize}**\n`;
      description += `> ⏱️ Pozostało czasu: \`${contest.timeLeft}\`\n`;
      description += `> 📍 Kanał: <#${contest.channelId}>\n`;
      description += `> 🆔 ID wiadomości: \`${contest.messageId}\`\n\n`;
    });
  }

  if (failedContests.length > 0) {
    description += `## ❌ Nie udało się zakończyć (${failedContests.length}):\n\n`;
    failedContests.forEach((contest, index) => {
      description += `**${index + 1}. ${contest.prize}**\n`;
      description += `> 🚫 Błąd: \`${contest.error}\`\n\n`;
    });
  }

  summaryEmbed.setDescription(description);

  await interaction.reply({
    embeds: [summaryEmbed],
    flags: [MessageFlags.Ephemeral], // Tylko osoba wpisująca widzi odpowiedź
  });
}

// --- Obsługa opuszczenia konkursu ---
async function handleKonkursLeave(interaction, msgId) {
  const contest = contests.get(msgId);
  if (!contest) {
    await interaction.update({
      content: "> `❌` × **Konkurs** nie został znaleziony.",
      components: [],
    });
    return;
  }

  const userId = interaction.user.id;
  
  // Sprawdź blokadę opuszczania konkursu
  const userBlocks = contestLeaveBlocks.get(userId) || {};
  const contestBlock = userBlocks[msgId];
  
  if (contestBlock && contestBlock.blockedUntil > Date.now()) {
    const remainingTime = contestBlock.blockedUntil - Date.now();
    const timeString = formatBlockTime(remainingTime);
    
    await interaction.update({
      content: `> \`⏳\` × Musisz poczekać **${timeString}**, aby ponownie opuścić konkurs.`,
      components: [],
    });
    return;
  }

  let participantsMap = contestParticipants.get(msgId);
  if (!participantsMap) {
    await interaction.update({
      content: "> `❌` × **Nie bierzesz** udziału w tym **konkursie**.",
      components: [],
    });
    return;
  }

  if (!participantsMap.has(userId)) {
    await interaction.update({
      content: "> `❌` × **Nie bierzesz** udziału w tym **konkursie**.",
      components: [],
    });
    return;
  }

  // Zwiększ licznik wyjść i nałóż blokadę jeśli to drugie wyjście
  const currentLeaveCount = (contestBlock?.leaveCount || 0) + 1;
  
  if (currentLeaveCount >= 2) {
    // Nałóż blokadę 30 minut
    const blockedUntil = Date.now() + (30 * 60 * 1000); // 30 minut
    
    if (!userBlocks[msgId]) {
      userBlocks[msgId] = { leaveCount: 0, blockedUntil: 0 };
    }
    
    userBlocks[msgId].leaveCount = currentLeaveCount;
    userBlocks[msgId].blockedUntil = blockedUntil;
    
    contestLeaveBlocks.set(userId, userBlocks);
    scheduleSavePersistentState();
  } else {
    // Pierwsze wyjście - tylko zaktualizuj licznik
    if (!userBlocks[msgId]) {
      userBlocks[msgId] = { leaveCount: 0, blockedUntil: 0 };
    }
    
    userBlocks[msgId].leaveCount = currentLeaveCount;
    contestLeaveBlocks.set(userId, userBlocks);
    scheduleSavePersistentState();
  }

  // Usuwamy użytkownika z konkursu
  participantsMap.delete(userId);
  scheduleSavePersistentState();

  const participantsCount = participantsMap.size;

  // Aktualizujemy embed konkursu
  try {
    const ch = await client.channels.fetch(contest.channelId).catch(() => null);
    if (ch) {
      const origMsg = await ch.messages.fetch(msgId).catch(() => null);
      if (origMsg) {
        let updatedDescription =
          `🎁 **•** Nagroda: **${contest.prize}**\n\n` +
          `🕐 **•** Koniec konkursu: ${formatTimeDelta(contest.endsAt - Date.now())}\n` +
          `👑 **•** Liczba zwycięzców: **${contest.winnersCount}**\n` +
          `👥 **•** Liczba uczestników: **${participantsCount}**`;

        if (contest.invitesRequired > 0) {
          const inviteForm = getPersonForm(contest.invitesRequired);
          updatedDescription += `\n\n⚠️ Wymagane: dodać ${contest.invitesRequired} ${inviteForm} na serwer`;
        }

        // Pobierz istniejący embed i zachowaj czarny kwadrat
        const embed = origMsg.embeds[0]?.toJSON() || {};
        const originalDescription = embed.description || '';
        
        // Wyodrębnij czarny kwadrat z oryginalnego opisu
        const blackBoxMatch = originalDescription.match(/```[\s\S]*?```/);
        const blackBox = blackBoxMatch ? blackBoxMatch[0] : '';
        
        // Połącz czarny kwadrat z nowym opisem
        embed.description = blackBox + '\n' + updatedDescription;

        const joinButton = new ButtonBuilder()
          .setCustomId(`konkurs_join_${msgId}`)
          .setLabel(`Weź udział (${participantsCount})`)
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(false);
        const row = new ActionRowBuilder().addComponents(joinButton);

        // Edytuj wiadomość - usuń stare załączniki i dodaj ten sam GIF ponownie
        try {
          const gifPath = path.join(
            __dirname,
            "attached_assets",
            "standard (4).gif",
          );
          const attachment = new AttachmentBuilder(gifPath, { name: "konkurs_start.gif" });
          embed.image = { url: "attachment://konkurs_start.gif" };
          
          await origMsg.edit({ 
            embeds: [embed], 
            components: [row],
            files: [attachment]
          }).catch(() => null);
        } catch (err) {
          console.warn("Nie udało się załadować GIFa przy edycji konkursu (leave):", err);
          // Fallback: usuń załączniki bez GIFa
          await origMsg.edit({ 
            embeds: [embed], 
            components: [row],
            attachments: []
          }).catch(() => null);
        }
      }
    }
  } catch (e) {
    console.warn("Nie udało się zaktualizować embed/btn konkursu:", e);
  }

  const leaveEmbed = new EmbedBuilder()
    .setColor(COLOR_BLUE)
    .setDescription("> \`🚪\` × Opuściłeś konkurs.");

  await interaction.update({
    embeds: [leaveEmbed],
    components: [],
  });
}

// --- Obsługa anulowania opuszczenia konkursu ---
async function handleKonkursCancelLeave(interaction, msgId) {
  await interaction.update({
    content: "> `📋` × Anulowano",
    components: [],
  });
}

// Modified: prefer fixed log channel ID 1450800337932783768 if accessible; otherwise fallback to channel name heuristics
async function getLogiTicketChannel(guild) {
  if (!guild) return null;
  // try the requested specific channel ID first (user requested)
  const forcedId = "1450800337932783768";
  try {
    const forced = await guild.channels.fetch(forcedId).catch(() => null);
    if (forced && forced.type === ChannelType.GuildText) return forced;
  } catch (e) {
    // ignore
  }

  // First try exact name 'logi-ticket', then contains or similar
  const ch =
    guild.channels.cache.find(
      (c) =>
        c.type === ChannelType.GuildText &&
        (c.name === "logi-ticket" ||
          c.name.toLowerCase().includes("logi-ticket") ||
          c.name.toLowerCase().includes("logi ticket") ||
          c.name.toLowerCase().includes("logi_ticket")),
    ) || null;
  return ch;
}

async function logTicketCreation(guild, ticketChannel, details) {
  try {
    const logCh = await getLogiTicketChannel(guild);
    if (!logCh) return;

    const embed = new EmbedBuilder()
      .setTitle("🎟️ Ticket utworzony")
      .setColor(COLOR_BLUE)
      .setDescription(
        `> \`🆔\` × Kanał: <#${ticketChannel.id}>\n` +
        `> \`👤\` × Właściciel: <@${details.openerId}> (\`${details.openerId}\`)\n` +
        `> \`📌\` × Typ ticketu: ${details.ticketTypeLabel}\n` +
        `> \`📄\` × Informacje:\n${details.formInfo}`,
      )
      .setTimestamp();

    await logCh.send({ embeds: [embed] });
  } catch (e) {
    console.error("logTicketCreation error:", e);
  }
}

async function archiveTicketOnClose(ticketChannel, closedById, ticketMeta) {
  try {
    const guild = ticketChannel.guild;
    const logCh = await getLogiTicketChannel(guild);
    if (!logCh) {
      console.warn("Brak kanału logi-ticket — pomijam logowanie ticketu.");
      return;
    }

    // Fetch all messages (up to 100)
    const fetched = await ticketChannel.messages
      .fetch({ limit: 100 })
      .catch(() => null);
    const messages = fetched ? Array.from(fetched.values()) : [];

    let beforeId = fetched && fetched.size ? fetched.last().id : null;
    while (beforeId) {
      const batch = await ticketChannel.messages
        .fetch({ limit: 100, before: beforeId })
        .catch(() => null);
      if (!batch || batch.size === 0) break;
      messages.push(...Array.from(batch.values()));
      beforeId = batch.size ? batch.last().id : null;
      if (batch.size < 100) break;
    }

    messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

    const openerId = ticketMeta?.userId || null;
    const claimedById = ticketMeta?.claimedBy || null;

    const participantsSet = new Set();
    for (const m of messages) {
      if (m && m.author && m.author.id) participantsSet.add(m.author.id);
    }
    const participants = Array.from(participantsSet);
    const participantsPreview = participants.slice(0, 20);
    const participantsText = participantsPreview.length
      ? `${participantsPreview.map((id) => `<@${id}>`).join(" ")}${participants.length > participantsPreview.length ? ` (+${participants.length - participantsPreview.length})` : ""}`
      : "brak";

    const embed = new EmbedBuilder()
      .setTitle("🎟️ Ticket zamknięty")
      .setColor(COLOR_BLUE)
      .setDescription(
        `> \`🆔\` × Kanał: **${ticketChannel.name}** (\`${ticketChannel.id}\`)\n` +
          `> \`👤\` × Właściciel: ${openerId ? `<@${openerId}> (\`${openerId}\`)` : "unknown"}\n` +
          `> \`🧑‍💼\` × Przejęty przez: ${claimedById ? `<@${claimedById}> (\`${claimedById}\`)` : "brak"}\n` +
          `> \`🔒\` × Zamknął: <@${closedById}> (\`${closedById}\`)\n` +
          `> \`💬\` × Wiadomości: **${messages.length}**\n` +
          `> \`👥\` × Uczestnicy: ${participantsText}`,
      )
      .setTimestamp();

    // Build transcript
    const lines = messages.map((m) => {
      const time = new Date(m.createdTimestamp).toLocaleString("pl-PL");
      const authorTag = m.author ? m.author.tag : "unknown";
      const authorId = m.author ? m.author.id : "unknown";
      const content = m.content ? m.content : "";
      const attachmentUrls =
        m.attachments && m.attachments.size
          ? Array.from(m.attachments.values())
            .map((a) => a.url)
            .join(", ")
          : "";
      const attachments = attachmentUrls ? `\n[ATTACHMENTS: ${attachmentUrls}]` : "";
      return `${time}\n${authorTag} (${authorId})\n${content}${attachments}`;
    });

    let transcriptText =
      `Ticket: ${ticketChannel.name}\n` +
      `Channel ID: ${ticketChannel.id}\n` +
      `Closed by: ${closedById}\n` +
      `Opened by: ${openerId || "unknown"}\n` +
      `Claimed by: ${claimedById || "brak"}\n` +
      `Messages: ${messages.length}\n` +
      `Participants: ${participants.join(", ") || "brak"}\n\n` +
      `--- MESSAGES ---\n\n` +
      lines.join("\n\n");

    const maxBytes = 7_500_000;
    let buffer = Buffer.from(transcriptText, "utf-8");
    if (buffer.length > maxBytes) {
      const ratio = maxBytes / buffer.length;
      const cutIndex = Math.max(0, Math.floor(transcriptText.length * ratio) - 50);
      transcriptText = `${transcriptText.slice(0, cutIndex)}\n\n[TRUNCATED]`;
      buffer = Buffer.from(transcriptText, "utf-8");
    }

    const fileName = `ticket-${ticketChannel.name.replace(/[^a-z0-9-_]/gi, "_")}-${Date.now()}.txt`;
    const attachment = new AttachmentBuilder(buffer, { name: fileName });

    await logCh.send({ embeds: [embed], files: [attachment] });
  } catch (e) {
    console.error("archiveTicketOnClose error:", e);
  }
}

// ---------------------------------------------------
// SYSTEM ROZLICZEN TYGODNIOWYCH
const ROZLICZENIA_CHANNEL_ID = "1449162620807675935";
const ROZLICZENIA_LOGS_CHANNEL_ID = "1457140136461730075";
const ROZLICZENIA_PROWIZJA = 0.10; // 10%

// Mapa na sumy sprzedaży w tygodniu
const weeklySales = new Map(); // userId -> { amount, lastUpdate }

// Funkcja do wysyłania wiadomości o rozliczeniach
async function sendRozliczeniaMessage() {
  try {
    const channel = await client.channels.fetch(ROZLICZENIA_CHANNEL_ID);
    if (!channel) return;

    // Sprawdź czy istnieje wiadomość informacyjna bota do usunięcia
    const messages = await channel.messages.fetch({ limit: 50 });
    const botMessage = messages.find(msg =>
      msg.author.id === client.user.id &&
      msg.embeds.length > 0 &&
      msg.embeds[0].title?.includes("ROZLICZENIA TYGODNIOWE")
    );

    // Jeśli wiadomość istnieje, usuń ją
    if (botMessage) {
      await botMessage.delete();
      console.log("Usunięto istniejącą wiadomość informacyjną ROZLICZENIA TYGODNIOWE");
    }

    // Wyślij nową wiadomość
    const embed = new EmbedBuilder()
      .setColor(0xd4af37)
      .setTitle("\`💱\` ROZLICZENIA TYGODNIOWE")
      .setDescription(
        "> \`ℹ️\` **Jeżeli sprzedajecie coś na shopie, wysyłacie tutaj kwotę, za którą dokonaliście sprzedaży. Na koniec każdego tygodnia w niedzielę rano macie czas do godziny 20:00, aby rozliczyć się i zapłacić 10% od łącznej sumy sprzedaży z __całego tygodnia.__**"
      )
      .setFooter({ text: "Użyj komendy /rozliczenie aby dodać sprzedaż" })
      .setTimestamp();

    await channel.send({ embeds: [embed] });
    console.log("Wysłano wiadomość informacyjną ROZLICZENIA TYGODNIOWE");
  } catch (err) {
    console.error("Błąd wysyłania wiadomości ROZLICZENIA TYGODNIOWE:", err);
  }
}

// Funkcja do sprawdzania i resetowania cotygodniowych rozliczeń
async function checkWeeklyReset() {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0 = niedziela
  const hour = now.getHours();

  // Reset w niedzielę o 20:01
  if (dayOfWeek === 0 && hour === 20 && now.getMinutes() === 1) {
    try {
      const logsChannel = await client.channels.fetch(ROZLICZENIA_LOGS_CHANNEL_ID);
      if (logsChannel && weeklySales.size > 0) {
        let totalSales = 0;
        let report = "📊 **RAPORT TYGODNIOWY**\n\n";

        for (const [userId, data] of weeklySales) {
          const prowizja = data.amount * ROZLICZENIA_PROWIZJA;
          report += `> 👤 <@${userId}>: Sprzedał: ${data.amount.toLocaleString("pl-PL")} zł | Do zapałaty: ${prowizja.toFixed(2)} zł\n`;
          totalSales += data.amount;
        }

        const totalProwizja = (totalSales * ROZLICZENIA_PROWIZJA).toFixed(2);
        report += `\n> 💰 **Łączna sprzedaż:** ${totalSales.toLocaleString("pl-PL")} zł\n`;
        report += `> 💸 **Łączna prowizja (10%):** ${totalProwizja} zł\n`;
        report += `> 📱 **Przelew na numer:** 880 260 392\n`;
        report += `> ⏳ **Termin płatności:** do 20:00 dnia dzisiejszego\n`;
        report += `> 🚫 **Brak płatności = brak dostępu do ticketów**`;

        await logsChannel.send(report);
      }

      // Reset mapy
      weeklySales.clear();
      console.log("Zresetowano cotygodniowe rozliczenia");
    } catch (err) {
      console.error("Błąd resetowania rozliczeń:", err);
    }
  }
}

// Listener dla nowych wiadomości na kanale rozliczeń
client.on('messageCreate', async (message) => {
  // Ignoruj wiadomości od botów
  if (message.author.bot) return;
  
  // Sprawdź czy wiadomość jest na kanale rozliczeń
  if (message.channelId === ROZLICZENIA_CHANNEL_ID) {
    // Jeśli to nie jest komenda rozliczenia, usuń wiadomość
    if (!message.content.startsWith('/rozliczenie')) {
      try {
        await message.delete();
        await message.author.send({
          embeds: [{
            color: 0xff0000,
            title: "❌ Ograniczenie kanału",
            description: `Na kanale <#${ROZLICZENIA_CHANNEL_ID}> można używać tylko komend rozliczeń!\n\n` +
                     `**Dostępne komendy:**\n` +
                     `• \`/rozliczenie [kwota]\` - dodaj sprzedaż`,
            footer: { text: "NewShop 5k$-1zł🏷️-×┃procenty-sell" }
          }]
        });
      } catch (err) {
        console.error("Błąd usuwania wiadomości z kanału rozliczeń:", err);
      }
      return;
    }
    
    // Odśwież wiadomość ROZLICZENIA TYGODNIOWE
    setTimeout(sendRozliczeniaMessage, 1000); // Małe opóźnienie dla pewności
  }
});

// Uruchom sprawdzanie co 5 minut
setInterval(checkWeeklyReset, 5 * 60 * 1000);

// Wysyłaj wiadomość o rozliczeniach co 12 godzin
setInterval(sendRozliczeniaMessage, 12 * 60 * 60 * 1000);

// Wyślij wiadomość przy starcie bota
setTimeout(sendRozliczeniaMessage, 5000);

// ---------------------------------------------------
// FULL MONITORING MODE - System statusów i alertów
// ---------------------------------------------------

const https = require('https');

let startTime = Date.now();
let lastPingCheck = Date.now();
let pingHistory = [];
let errorCount = 0;
let lastErrorTime = null;

// Funkcja formatowania uptime
function formatUptime(ms) {
  const sec = Math.floor(ms / 1000);
  const min = Math.floor(sec / 60);
  const hrs = Math.floor(min / 60);
  const days = Math.floor(hrs / 24);

  return `${days}d ${hrs % 24}h ${min % 60}m ${sec % 60}s`;
}

// Funkcja wysyłania embeda na webhook
async function sendMonitoringEmbed(title, description, color) {
  const webhookUrl = process.env.UPTIME_WEBHOOK;
  if (!webhookUrl) return;

  try {
    const payload = JSON.stringify({
      embeds: [{
        title: title,
        description: description,
        color: color,
        timestamp: new Date().toISOString(),
        footer: {
          text: "Bot Monitoring System",
          icon_url: client.user?.displayAvatarURL()
        }
      }]
    });

    const url = new URL(webhookUrl);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const req = https.request(options, (res) => {
      res.on('data', () => {});
      res.on('end', () => {});
    });

    req.on('error', (err) => {
      console.error("Błąd wysyłania monitoringu:", err);
    });

    req.write(payload);
    req.end();
  } catch (err) {
    console.error("Błąd wysyłania monitoringu:", err);
  }
}

// Funkcja sprawdzania statusu bota
function getBotStatus() {
  const ping = client.ws?.ping || 0;
  const uptime = Date.now() - startTime;
  
  let status = "🟢 Stabilny";
  let statusColor = 0x00ff00;
  
  if (ping > 400 || errorCount > 5) {
    status = "🔴 Krytyczny";
    statusColor = 0xff0000;
  } else if (ping > 200 || errorCount > 2) {
    status = "🟠 Ostrzeżenie";
    statusColor = 0xffaa00;
  }

  return { status, statusColor, ping, uptime };
}

// 1. Heartbeat co 5 minut (bot żyje + ping + uptime)
setInterval(async () => {
  const webhookUrl = process.env.UPTIME_WEBHOOK;
  if (!webhookUrl) return;

  const ping = client.ws?.ping || 0;
  const uptime = formatUptime(Date.now() - startTime);
  const { status, statusColor } = getBotStatus();

  // Zapisz ping do historii
  pingHistory.push(ping);
  if (pingHistory.length > 12) pingHistory.shift(); // 1 godzina historii

  const avgPing = Math.round(pingHistory.reduce((a, b) => a + b, 0) / pingHistory.length);

  const description = `⏱ **Uptime:** ${uptime}\n📡 **Ping:** ${ping}ms (średnio: ${avgPing}ms)\n🔢 **Błędy:** ${errorCount}\n📊 **Status:** ${status}`;

  await sendMonitoringEmbed("💓 Heartbeat - Bot działa", description, statusColor);
}, 5 * 60 * 1000); // co 5 minut

// 2. Alert przy błędzie krytycznym (bot padnie)
process.on("uncaughtException", async (err) => {
  console.error("🔴 Błąd krytyczny:", err);
  
  errorCount++;
  lastErrorTime = Date.now();

  const description = `**Błąd krytyczny detected:**\n\`${err.message}\`\n\n**Stack:**\n\`${err.stack?.substring(0, 1000) || "Brak stack trace"}...\`\n\n**Czas:** ${new Date().toLocaleString("pl-PL")}`;

  await sendMonitoringEmbed("🔴 BOT PADŁ - Błąd krytyczny", description, 0xff0000);

  // Daj chwilę na wysłanie alertu
  setTimeout(() => process.exit(1), 2000);
});

// 3. Alert przy zamknięciu procesu
process.on("exit", async () => {
  const uptime = formatUptime(Date.now() - startTime);
  const description = `Bot został zamknięty (process.exit)\n⏱ **Czas działania:** ${uptime}\n📊 **Liczba błędów:** ${errorCount}`;

  await sendMonitoringEmbed("🔴 Bot zamknięty", description, 0xff0000);
});

// 4. Monitor HTTP sprawdzający czy UptimeRobot pinguje
setInterval(async () => {
  const webhookUrl = process.env.UPTIME_WEBHOOK;
  if (!webhookUrl) return;

  const monitorUrl = process.env.MONITOR_HTTP_URL || process.env.RENDER_EXTERNAL_URL;
  if (!monitorUrl) {
    console.warn('[MONITOR_HTTP] Pomijam — brak MONITOR_HTTP_URL/RENDER_EXTERNAL_URL');
    return;
  }

  try {
    const startTime = Date.now();
    const parsed = new URL(monitorUrl);

    const options = {
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      path: parsed.pathname || '/',
      method: 'GET'
    };

    const req = https.request(options, (res) => {
      const responseTime = Date.now() - startTime;
      
      if (res.statusCode === 200) {
        const description = `🌐 **Monitor HTTP:** Aktywny\n📡 **Response time:** ${responseTime}ms\n📊 **Status:** HTTP ${res.statusCode}`;
        sendMonitoringEmbed("🟢 Monitor HTTP - OK", description, 0x00ff00);
      } else {
        const description = `🟠 **Monitor HTTP:** Nieoczekiwana odpowiedź\n📊 **Status:** HTTP ${res.statusCode}\n⏱ **Response time:** ${responseTime}ms`;
        sendMonitoringEmbed("🟠 Monitor HTTP - Ostrzeżenie", description, 0xffaa00);
      }
    });

    req.on('error', (err) => {
      const description = `🔴 **Monitor HTTP:** Brak odpowiedzi\n**Błąd:** ${err.message}\n**Czas:** ${new Date().toLocaleString("pl-PL")}`;
      sendMonitoringEmbed("🔴 Monitor HTTP - Błąd", description, 0xff0000);
    });

    req.setTimeout(10000, () => {
      req.destroy();
      const description = `🔴 **Monitor HTTP:** Timeout\n**Czas:** ${new Date().toLocaleString("pl-PL")}`;
      sendMonitoringEmbed("🔴 Monitor HTTP - Timeout", description, 0xff0000);
    });

    req.end();
  } catch (err) {
    const description = `🔴 **Monitor HTTP:** Błąd sprawdzania\n**Błąd:** ${err.message}\n**Czas:** ${new Date().toLocaleString("pl-PL")}`;
    sendMonitoringEmbed("🔴 Monitor HTTP - Błąd", description, 0xff0000);
  }
}, 10 * 60 * 1000); // co 10 minut

// 5. Raport okresowy co 12 godzin
setInterval(async () => {
  const webhookUrl = process.env.UPTIME_WEBHOOK;
  if (!webhookUrl) return;

  const { status, statusColor, ping, uptime } = getBotStatus();
  const uptimeFormatted = formatUptime(uptime);
  const avgPing = pingHistory.length > 0 ? Math.round(pingHistory.reduce((a, b) => a + b, 0) / pingHistory.length) : 0;

  const description = `📊 **RAPORT DZIAŁANIA BOTA**\n\n` +
    `⏱ **Uptime:** ${uptimeFormatted}\n` +
    `📡 **Ping aktualny:** ${ping}ms\n` +
    `📈 **Ping średni:** ${avgPing}ms\n` +
    `🌐 **Monitor HTTP:** Aktywny\n` +
    `🔢 **Liczba błędów:** ${errorCount}\n` +
    `📊 **Status:** ${status}\n` +
    `🕐 **Raport wygenerowany:** ${new Date().toLocaleString("pl-PL")}`;

  await sendMonitoringEmbed("📊 Raport okresowy - 12h", description, statusColor);
}, 12 * 60 * 60 * 1000); // co 12 godzin

// 6. Monitorowanie reconnectów Discord
client.on("reconnecting", () => {
  console.log("🔄 Bot próbuje się połączyć ponownie...");
  errorCount++;
});

client.on("resume", () => {
  const description = `🔄 **Bot wznowił połączenie**\n⏱ **Czas działania:** ${formatUptime(Date.now() - startTime)}\n📊 **Liczba błędów:** ${errorCount}`;
  sendMonitoringEmbed("🟢 Połączenie wznowione", description, 0x00ff00);
});

// 7. Funkcja ręcznego sprawdzania statusu
async function checkBotStatus() {
  const { status, statusColor, ping, uptime } = getBotStatus();
  const uptimeFormatted = formatUptime(uptime);
  const avgPing = pingHistory.length > 0 ? Math.round(pingHistory.reduce((a, b) => a + b, 0) / pingHistory.length) : 0;

  return {
    status,
    statusColor,
    ping,
    avgPing,
    uptime: uptimeFormatted,
    errorCount,
    lastErrorTime,
    guilds: client.guilds.cache.size,
    users: client.users.cache.size,
    channels: client.channels.cache.size
  };
}

// Szybka weryfikacja tokena przed logowaniem (REST /users/@me)
async function validateBotToken() {
  return new Promise((resolve) => {
    try {
      const req = https.request({
        method: 'GET',
        hostname: 'discord.com',
        path: '/api/v10/users/@me',
        headers: {
          Authorization: `Bot ${process.env.BOT_TOKEN}`,
        },
      }, (res) => {
        let body = '';
        res.on('data', (chunk) => body += chunk);
        res.on('end', () => {
          console.log(`[TOKEN_CHECK] status=${res.statusCode}`);
          if (body) console.log(`[TOKEN_CHECK] body=${body.slice(0, 200)}`);
          resolve(res.statusCode);
        });
      });

      req.on('error', (err) => {
        console.error('[TOKEN_CHECK] error:', err.message);
        resolve(null);
      });

      req.setTimeout(5000, () => {
        console.error('[TOKEN_CHECK] timeout');
        req.destroy();
        resolve(null);
      });

      req.end();
    } catch (err) {
      console.error('[TOKEN_CHECK] unexpected error:', err.message);
      resolve(null);
    }
  });
}

// 8. Komenda statusu (opcjonalnie - można dodać do slash commands)
async function sendStatusReport(channel) {
  const status = await checkBotStatus();
  
  const embed = new EmbedBuilder()
    .setColor(status.statusColor)
    .setTitle("📊 Status Bota")
    .setDescription(`**Status:** ${status.status}`)
    .addFields(
      { name: "⏱ Uptime", value: status.uptime, inline: true },
      { name: "📡 Ping", value: `${status.ping}ms (avg: ${status.avgPing}ms)`, inline: true },
      { name: "🔢 Błędy", value: status.errorCount.toString(), inline: true },
      { name: "🌐 Serwery", value: status.guilds.toString(), inline: true },
      { name: "👥 Użytkownicy", value: status.users.toString(), inline: true },
      { name: "💬 Kanały", value: status.channels.toString(), inline: true }
    )
    .setTimestamp()
    .setFooter({ text: "Bot Monitoring System" });

  await channel.send({ embeds: [embed] });
}

console.log("🟢 FULL MONITORING MODE aktywowany - heartbeat co 5min, alerty błędów, monitor HTTP");

// ---------------------------------------------------

console.log("[DEBUG] Próba połączenia z Discord...");
console.log("[DEBUG] BOT_TOKEN exists:", !!process.env.BOT_TOKEN);
console.log("[DEBUG] BOT_TOKEN length:", process.env.BOT_TOKEN?.length || 0);

// Test WebSocket połączenia
console.log("[WS_TEST] Testuję połączenie WebSocket z Discord...");
try {
  const WebSocket = require('ws');
  const ws = new WebSocket('wss://gateway.discord.gg/?v=10&encoding=json');
  
  const wsTimeout = setTimeout(() => {
    console.error("[WS_TEST] WebSocket timeout - Render.com blokuje połączenia!");
    ws.terminate();
  }, 10000);
  
  ws.on('open', () => {
    console.log("[WS_TEST] WebSocket połączony pomyślnie!");
    clearTimeout(wsTimeout);
    ws.close();
  });
  
  ws.on('error', (err) => {
    console.error("[WS_TEST] WebSocket error:", err.message);
    clearTimeout(wsTimeout);
  });
  
  ws.on('close', () => {
    console.log("[WS_TEST] WebSocket zamknięty");
  });
} catch (err) {
  console.error("[WS_TEST] Błąd tworzenia WebSocket:", err.message);
}

// Prosta funkcja retry z backoffem i obsługą 429 + diagnostyka
async function loginWithRetry(maxRetries = 5) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const attempt = i + 1;
      console.log(`[LOGIN] Próba ${attempt}/${maxRetries}...`);

      const slowLoginWarning = setTimeout(() => {
        console.warn(`[LOGIN] Logowanie trwa długo (>30s) — czekam na odpowiedź Discorda...`);
      }, 30000);

      const hardTimeout = new Promise((_, reject) => setTimeout(() => reject(new Error('LOGIN_HARD_TIMEOUT_90S')), 90000));

      await Promise.race([client.login(process.env.BOT_TOKEN), hardTimeout]);

      clearTimeout(slowLoginWarning);

      console.log("[LOGIN] Sukces! Bot połączony z Discord.");
      return;
    } catch (err) {
      const is429 = err?.code === 429 || /429/.test(err?.message || "");
      const retryAfterHeader = Number(err?.data?.retry_after || err?.retry_after || 0) * 1000;
      const backoff = is429 ? Math.max(retryAfterHeader, 30000) : 10000 * (i + 1);

      console.error(`[LOGIN] Błąd próby ${i + 1}:`, err?.message || err);
      if (err?.code) console.error(`[LOGIN] err.code=${err.code}`);
      if (err?.status) console.error(`[LOGIN] err.status=${err.status}`);
      if (err?.data?.retry_after) console.error(`[LOGIN] retry_after=${err.data.retry_after}`);

      if (err?.name === 'DiscordAPIError' && err?.rawError) {
        console.error('[LOGIN] rawError:', err.rawError);
      }

      if (i < maxRetries - 1) {
        console.log(`[LOGIN] Czekam ${Math.round(backoff / 1000)}s przed kolejną próbą...`);
        await new Promise(resolve => setTimeout(resolve, backoff));
      }
    }
  }

  console.error("[LOGIN] Wszystkie próby nieudane!");

  // Sprawdź połączenie sieciowe
  console.log("[NETWORK] Sprawdzam połączenie z Discord API...");
  try {
    const https = require('https');
    const req = https.request('https://discord.com/api/v10/gateway', (res) => {
      console.log(`[NETWORK] Discord API response: ${res.statusCode}`);
      if (res.statusCode === 200) {
        console.log("[NETWORK] Discord API jest dostępne - problem może być z WebSocket");
      } else {
        console.log(`[NETWORK] Discord API zwróciło: ${res.statusCode}`);
      }
    });
    req.on('error', (err) => {
      console.error("[NETWORK] Błąd połączenia z Discord API:", err.message);
    });
    req.setTimeout(5000, () => {
      console.error("[NETWORK] Timeout połączenia z Discord API");
      req.destroy();
    });
    req.end();
  } catch (err) {
    console.error("[NETWORK] Błąd sprawdzania połączenia:", err.message);
  }
}

// Start login
validateBotToken().finally(() => loginWithRetry());

const express = require('express');
const app = express();

function getVideoContentType(filePath) {
  const ext = path.extname(filePath || "").toLowerCase();
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".mov") return "video/quicktime";
  if (ext === ".webm") return "video/webm";
  return "application/octet-stream";
}

app.get('/videos/:videoKey', (req, res) => {
  try {
    const videoKey = (req.params.videoKey || "").trim();
    const videoCfg = MODS_VIDEO_FILES.find((v) => v.key === videoKey);

    if (!videoCfg) {
      res.status(404).json({ error: "video_not_found" });
      return;
    }

    const localVideoPath = resolveLocalModsVideoPath(videoCfg);
    if (!localVideoPath) {
      res.status(404).json({ error: "video_file_missing" });
      return;
    }

    const stat = fs.statSync(localVideoPath);
    const totalSize = stat.size;
    const rangeHeader = req.headers.range;
    const contentType = getVideoContentType(localVideoPath);

    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.setHeader("Content-Type", contentType);
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${path.basename(localVideoPath)}"`,
    );

    if (!rangeHeader) {
      res.setHeader("Content-Length", totalSize);
      const stream = fs.createReadStream(localVideoPath);
      stream.on("error", (err) => {
        console.error("[VIDEO] Błąd streamu bez range:", err);
        if (!res.headersSent) {
          res.status(500).json({ error: "stream_error" });
        } else {
          res.end();
        }
      });
      stream.pipe(res);
      return;
    }

    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
    if (!match) {
      res.status(416).setHeader("Content-Range", `bytes */${totalSize}`);
      res.end();
      return;
    }

    let start = match[1] ? parseInt(match[1], 10) : 0;
    let end = match[2] ? parseInt(match[2], 10) : totalSize - 1;

    if (!Number.isFinite(start) || start < 0) start = 0;
    if (!Number.isFinite(end) || end >= totalSize) end = totalSize - 1;

    if (start > end || start >= totalSize) {
      res.status(416).setHeader("Content-Range", `bytes */${totalSize}`);
      res.end();
      return;
    }

    const chunkSize = end - start + 1;
    res.status(206);
    res.setHeader("Content-Range", `bytes ${start}-${end}/${totalSize}`);
    res.setHeader("Content-Length", chunkSize);

    const stream = fs.createReadStream(localVideoPath, { start, end });
    stream.on("error", (err) => {
      console.error("[VIDEO] Błąd streamu range:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "stream_error" });
      } else {
        res.end();
      }
    });
    stream.pipe(res);
  } catch (err) {
    console.error("[VIDEO] Błąd endpointu /videos/:videoKey:", err);
    res.status(500).json({ error: "internal_error" });
  }
});

// Health check endpoint
app.get('/', (req, res) => {
  const status = {
    status: 'alive',
    timestamp: new Date().toISOString(),
    discord_status: client.isReady() ? 'connected' : 'disconnected',
    uptime: client.uptime ? Math.floor(client.uptime / 1000) : 0,
    guilds: client.isReady() ? client.guilds.cache.size : 0,
    bot_tag: client.user ? client.user.tag : 'Not connected',
    ready: client.isReady()
  };
  
  // Sprawdź czy request chce JSON czy HTML
  if (req.headers.accept && req.headers.accept.includes('application/json')) {
    res.json(status, null, 2);
  } else {
    // Formatowanie HTML dla lepszej czytelności
    res.send(`
      <h1>🤖 Bot Status Monitor</h1>
      <pre>${JSON.stringify(status, null, 2)}</pre>
      <hr>
      <p><strong>Health Check:</strong> <a href="/health">/health</a></p>
      <p><strong>Timestamp:</strong> ${new Date().toLocaleString()}</p>
    `);
  }
});

app.get('/health', (req, res) => {
  const isHealthy = client.isReady();
  const status = {
    status: isHealthy ? 'healthy' : 'unhealthy',
    discord_connected: isHealthy,
    timestamp: new Date().toISOString(),
    uptime: client.uptime ? Math.floor(client.uptime / 1000) : 0,
    guilds: client.isReady() ? client.guilds.cache.size : 0
  };
  
  res.status(isHealthy ? 200 : 503).json(status, null, 2);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[HTTP] Status endpoint nasłuchuje na porcie ${PORT}`);
});
