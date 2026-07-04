const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// -------- Shared utilities --------

function getCurrentWeekStartString() {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const diff = now.getDate() - dayOfWeek;
  const weekStart = new Date(now.setDate(diff));
  weekStart.setHours(0, 0, 0, 0);
  return weekStart.toISOString().split("T")[0];
}

async function supabaseUpsert(table, data, logKey) {
  const { error } = await supabase.from(table).upsert(data);
  if (error) console.error(`[Supabase] Błąd zapisu ${table}:`, error);
  else console.log(`[Supabase] Zapisano ${table}: ${logKey}`);
}

async function supabaseSelectAll(table, filters = {}, defaultReturn = []) {
  let query = supabase.from(table).select("*");
  for (const [col, val] of Object.entries(filters)) {
    query = query.eq(col, val);
  }
  const { data, error } = await query;
  if (error) {
    console.error(`[Supabase] Błąd odczytu ${table}:`, error);
    return defaultReturn;
  }
  return data;
}

async function supabaseDelete(table, filters, logKey) {
  let query = supabase.from(table).delete();
  for (const [col, val] of Object.entries(filters)) {
    query = query.eq(col, val);
  }
  const { error } = await query;
  if (error) {
    console.error(`[Supabase] Błąd usuwania ${table}:`, error);
    return false;
  }
  console.log(`[Supabase] Usunięto ${table}: ${logKey}`);
  return true;
}

async function saveWeeklyInviteData(table, guildId, inviterId, count) {
  const weekStartStr = getCurrentWeekStartString();
  await supabaseUpsert(table, {
    guild_id: guildId,
    inviter_id: inviterId,
    count: count,
    week_start: weekStartStr,
  }, `${guildId}/${inviterId} -> ${count}`);
}

async function getWeeklyInviteData(table, guildId) {
  const weekStartStr = getCurrentWeekStartString();
  const data = await supabaseSelectAll(table, {
    guild_id: guildId,
    week_start: weekStartStr,
  }, []);
  const result = {};
  data.forEach(item => {
    result[item.inviter_id] = item.count;
  });
  return result;
}

// -------- Weekly sales --------

async function saveWeeklySale(
  userId,
  amount,
  guildId = "default",
  paid = false,
  paidAt = null,
  lastUpdate = Date.now()
) {
  const weekStart = getCurrentWeekStartString();
  await supabaseUpsert("weekly_sales", {
    user_id: userId,
    guild_id: guildId,
    amount,
    paid,
    paid_at: paidAt ? new Date(paidAt).toISOString() : null,
    updated_at: new Date(lastUpdate).toISOString(),
    week_start: weekStart,
  }, `${guildId}/${userId} -> ${amount} (paid=${paid})`);
}

async function getWeeklySales(guildId = null) {
  const weekStartStr = getCurrentWeekStartString();
  const filters = { week_start: weekStartStr };
  if (guildId && guildId !== "default") {
    filters.guild_id = guildId;
  }
  return supabaseSelectAll("weekly_sales", filters);
}

async function resetWeeklySales(guildId = null) {
  const weekStartStr = getCurrentWeekStartString();
  const filters = { week_start: weekStartStr };
  if (guildId && guildId !== "default") {
    filters.guild_id = guildId;
  }

  let query = supabase.from("weekly_sales").delete();
  for (const [col, val] of Object.entries(filters)) {
    query = query.eq(col, val);
  }
  const { error } = await query;
  if (error) {
    console.error("[Supabase] Błąd resetowania weekly_sales:", error);
    return false;
  }

  console.log(
    `[Supabase] Zresetowano weekly_sales dla tygodnia ${weekStartStr}${guildId && guildId !== "default" ? ` w guild ${guildId}` : ""}`
  );
  return true;
}

// -------- Invite counts (weekly) --------

async function saveInviteCount(guildId, inviterId, count) {
  await saveWeeklyInviteData("invite_counts", guildId, inviterId, count);
}

async function getInviteCounts(guildId) {
  return getWeeklyInviteData("invite_counts", guildId);
}

// -------- Invite total joined (weekly) --------

async function saveInviteTotalJoined(guildId, inviterId, count) {
  await saveWeeklyInviteData("invite_total_joined", guildId, inviterId, count);
}

async function getInviteTotalJoined(guildId) {
  return getWeeklyInviteData("invite_total_joined", guildId);
}

// -------- Invite fake accounts (weekly) --------

async function saveInviteFakeAccounts(guildId, inviterId, count) {
  await saveWeeklyInviteData("invite_fake_accounts", guildId, inviterId, count);
}

async function getInviteFakeAccounts(guildId) {
  return getWeeklyInviteData("invite_fake_accounts", guildId);
}

// -------- Invite bonus invites --------

async function saveInviteBonusInvites(guildId, userId, bonus) {
  await supabaseUpsert("invite_bonus_invites", {
    guild_id: guildId,
    user_id: userId,
    bonus: bonus,
  }, `${guildId}/${userId} -> ${bonus}`);
}

async function getInviteBonusInvites(guildId) {
  const data = await supabaseSelectAll("invite_bonus_invites", { guild_id: guildId });
  const result = {};
  data.forEach(item => {
    result[item.user_id] = item.bonus;
  });
  return result;
}

// -------- Invite rewards given --------

async function saveInviteRewardsGiven(guildId, userId, rewardsCount) {
  await supabaseUpsert("invite_rewards_given", {
    guild_id: guildId,
    user_id: userId,
    rewards_count: rewardsCount,
  }, `${guildId}/${userId} -> ${rewardsCount}`);
}

async function getInviteRewardsGiven(guildId) {
  const data = await supabaseSelectAll("invite_rewards_given", { guild_id: guildId });
  const result = {};
  data.forEach(item => {
    result[item.user_id] = item.rewards_count;
  });
  return result;
}

// -------- Invite reward levels --------

async function saveInviteRewardLevels(guildId, userId, levels) {
  await supabaseUpsert("invite_reward_levels", {
    guild_id: guildId,
    user_id: userId,
    reward_levels: levels,
  }, `${guildId}/${userId} -> ${JSON.stringify(levels)}`);
}

async function getInviteRewardLevels(guildId) {
  const data = await supabaseSelectAll("invite_reward_levels", { guild_id: guildId });
  const result = {};
  data.forEach(item => {
    result[item.user_id] = new Set(item.reward_levels || []);
  });
  return result;
}

// -------- Ticket owners --------

async function saveTicketOwner(channelId, ticketData) {
  await supabaseUpsert("ticket_owners", {
    channel_id: channelId,
    user_id: ticketData.userId,
    claimed_by: ticketData.claimedBy,
    locked: ticketData.locked || false,
    ticket_message_id: ticketData.ticketMessageId,
    updated_at: new Date().toISOString(),
  }, channelId);
}

async function getTicketOwners() {
  const data = await supabaseSelectAll("ticket_owners", {}, []);
  const result = {};
  data.forEach(item => {
    result[item.channel_id] = {
      claimedBy: item.claimed_by,
      userId: item.user_id,
      locked: item.locked,
      ticketMessageId: item.ticket_message_id,
    };
  });
  return result;
}

async function deleteTicketOwner(channelId) {
  await supabaseDelete("ticket_owners", { channel_id: channelId }, channelId);
}

// -------- Active codes --------

async function saveActiveCode(code, codeData) {
  await supabaseUpsert("active_codes", {
    code,
    user_id: codeData.oderId || codeData.user_id,
    discount: codeData.discount || 0,
    expires_at: new Date(codeData.expiresAt).toISOString(),
    used: codeData.used || false,
    reward: codeData.reward,
    reward_amount: codeData.rewardAmount,
    reward_text: codeData.rewardText,
    type: codeData.type,
    updated_at: new Date().toISOString(),
  }, code);
}

async function getActiveCodes() {
  return supabaseSelectAll("active_codes");
}

async function getActiveCode(code) {
  const { data, error } = await supabase
    .from("active_codes")
    .select("*")
    .eq("code", code)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("[Supabase] Błąd odczytu active_code:", error);
    return null;
  }
  return data || null;
}

async function updateActiveCode(code, updates) {
  const { error } = await supabase
    .from("active_codes")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("code", code);
  if (error) console.error("[Supabase] Błąd aktualizacji active_codes:", error);
  else console.log(`[Supabase] Zaktualizowano active_code: ${code}`);
}

async function deleteActiveCode(code) {
  await supabaseDelete("active_codes", { code }, code);
}

// -------- Contests --------

async function saveContest(messageId, contestData) {
  await supabaseUpsert("contests", {
    message_id: messageId,
    ...contestData,
    updated_at: new Date().toISOString(),
  }, messageId);
}

async function getContests() {
  return supabaseSelectAll("contests");
}

// -------- Contest participants --------

async function saveContestParticipant(messageId, userId) {
  await supabaseUpsert("contest_participants", {
    message_id: messageId,
    user_id: userId,
    joined_at: new Date().toISOString(),
  }, `${messageId}/${userId}`);
}

async function getContestParticipants(messageId) {
  return supabaseSelectAll("contest_participants", { message_id: messageId });
}

// -------- Get invited users by inviter --------

async function getInvitedUsersByInviter(guildId, inviterId) {
  return supabaseSelectAll("invites", {
    guild_id: guildId,
    inviter_id: inviterId,
    status: "joined",
  });
}

// -------- User spent tracking --------

async function addUserSpent(userId, amount, guildId = "default") {
  const { data } = await supabase
    .from("user_spent")
    .select("amount")
    .eq("user_id", userId)
    .eq("guild_id", guildId)
    .maybeSingle();

  const currentAmount = data ? Number(data.amount) || 0 : 0;
  const newAmount = currentAmount + amount;

  await supabaseUpsert("user_spent", {
    user_id: userId,
    guild_id: guildId,
    amount: newAmount,
    updated_at: new Date().toISOString(),
  }, `${userId}: +${amount} PLN (Razem: ${newAmount} PLN)`);
}

async function getUserSpent(userId, guildId = "default") {
  const { data, error } = await supabase
    .from("user_spent")
    .select("amount")
    .eq("user_id", userId)
    .eq("guild_id", guildId)
    .maybeSingle();

  if (error) {
    console.error("[Supabase] Błąd odczytu user_spent:", error);
    return 0;
  }
  return data ? Number(data.amount) || 0 : 0;
}

async function getTopSpenders(limit = 10, guildId = "default") {
  const { data, error } = await supabase
    .from("user_spent")
    .select("user_id, amount")
    .eq("guild_id", guildId)
    .order("amount", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[Supabase] Błąd odczytu top spenders:", error);
    return [];
  }
  return data || [];
}

async function setUserSpent(userId, amount, guildId = "default") {
  const { error } = await supabase
    .from("user_spent")
    .upsert({
      user_id: userId,
      guild_id: guildId,
      amount: amount,
      updated_at: new Date().toISOString(),
    });

  if (error) {
    console.error("[Supabase] Błąd ustawiania user_spent:", error);
    return false;
  }
  return true;
}

async function deleteUserSpent(userId, guildId = "default") {
  return supabaseDelete("user_spent", { user_id: userId, guild_id: guildId }, userId);
}

module.exports = {
  saveWeeklySale,
  getWeeklySales,
  resetWeeklySales,
  saveInviteCount,
  getInviteCounts,
  saveInviteTotalJoined,
  getInviteTotalJoined,
  saveInviteFakeAccounts,
  getInviteFakeAccounts,
  saveInviteBonusInvites,
  getInviteBonusInvites,
  saveInviteRewardsGiven,
  getInviteRewardsGiven,
  saveInviteRewardLevels,
  getInviteRewardLevels,
  saveTicketOwner,
  getTicketOwners,
  deleteTicketOwner,
  saveActiveCode,
  getActiveCode,
  getActiveCodes,
  updateActiveCode,
  deleteActiveCode,
  getInvitedUsersByInviter,
  saveContest,
  getContests,
  saveContestParticipant,
  getContestParticipants,
  addUserSpent,
  getUserSpent,
  getTopSpenders,
  setUserSpent,
  deleteUserSpent,
  supabase
};
