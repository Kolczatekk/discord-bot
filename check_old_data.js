const { createClient } = require("@supabase/supabase-js");

const OLD_URL = "https://wtrgebczyqumyyrnagus.supabase.co";
const OLD_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind0cmdlYmN6eXF1bXl5cm5hZ3VzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgwNzQxMzcsImV4cCI6MjA4MzY1MDEzN30.DfoskyY-P5llIM3lXyEhHDBfqX2VoNIw1AADPcgHm1Q";

const supabase = createClient(OLD_URL, OLD_KEY);

const TABLES = [
  "invite_counts",
  "invite_total_joined",
  "invite_fake_accounts",
  "invite_bonus_invites",
  "invite_rewards_given",
  "invite_reward_levels",
  "invites",
  "ticket_owners"
];

async function check() {
  console.log("Checking row counts in old database...");
  for (const table of TABLES) {
    try {
      const { data, error } = await supabase.from(table).select("*");
      if (error) {
        console.error(`Table ${table} error:`, error.message);
      } else {
        console.log(`Table ${table}: ${data ? data.length : 0} rows`);
        if (data && data.length > 0) {
          console.log("Sample:", data.slice(0, 2));
        }
      }
    } catch (e) {
      console.error(`Table ${table} exception:`, e);
    }
  }
}

check();
