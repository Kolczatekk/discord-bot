const { createClient } = require("@supabase/supabase-js");

const url = 'https://esckymvfxkpagbhhivgu.supabase.co'; 
const key = 'sb_publishable_wydMGaFmaLOrVTlBNxW04g_lwNmRhNz';

const client = createClient(url, key);

async function test() {
  console.log("Checking connection to new Supabase database...");
  const { data, error } = await client.from("bot_state").select("data").eq("id", 1).single();
  if (error) {
    console.error("Failed to read bot_state:", error.message);
  } else {
    console.log("Successfully read bot_state from new DB!");
    const state = data.data;
    if (state && state.inviteCounts) {
      console.log("inviteCounts entries:", Object.keys(state.inviteCounts).length);
      const guildId = "1350446732365926491";
      if (state.inviteCounts[guildId]) {
        console.log(`inviteCounts for guild ${guildId} entries:`, Object.keys(state.inviteCounts[guildId]).length);
        console.log("Sample invite counts:", JSON.stringify(state.inviteCounts[guildId]).substring(0, 500));
      } else {
        console.log(`No inviteCounts for guild ${guildId}`);
      }
    } else {
      console.log("No inviteCounts found in new DB state.");
    }
  }
}

test();
