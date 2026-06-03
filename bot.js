// ET Sniper Discord Bot
// Handles: /redeem, /status, /genkeys, /deletekey, /users, /revoke
// All secrets come from environment variables - NEVER hardcode tokens!

require('dotenv').config(); // Only used locally; Railway uses env vars directly

const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const fetch = require('node-fetch');

// ── CONFIG FROM ENV ────────────────────────────────────────────────────────
const BOT_TOKEN    = process.env.DISCORD_BOT_TOKEN;     // Set in Railway env vars
const CLIENT_ID    = process.env.DISCORD_CLIENT_ID;     // Your bot's application ID
const GUILD_ID     = process.env.DISCORD_GUILD_ID;      // Your server's ID
const API_URL      = process.env.API_URL;               // Your Railway backend URL, e.g. https://yourapp.railway.app
const ADMIN_TOKEN  = process.env.ADMIN_TOKEN;           // Same as backend's ADMIN_TOKEN
const REDEEM_CHANNEL_ID = process.env.REDEEM_CHANNEL_ID; // Channel where /redeem is allowed (optional)

if (!BOT_TOKEN || !CLIENT_ID || !GUILD_ID || !API_URL || !ADMIN_TOKEN) {
  console.error('[Bot] Missing required environment variables. Check your Railway env settings.');
  process.exit(1);
}

// ── SLASH COMMAND DEFINITIONS ──────────────────────────────────────────────
const commands = [
  // PUBLIC
  new SlashCommandBuilder()
    .setName('redeem')
    .setDescription('Redeem a key to activate your ET Sniper access')
    .addStringOption(opt =>
      opt.setName('key')
        .setDescription('Your key (e.g. ET-WEEK-AB12CD)')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('status')
    .setDescription('Check your ET Sniper subscription status'),

  // ADMIN ONLY
  new SlashCommandBuilder()
    .setName('genkeys')
    .setDescription('[ADMIN] Generate new keys')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(opt =>
      opt.setName('type')
        .setDescription('Key type')
        .setRequired(true)
        .addChoices(
          { name: '⚡ LFT (1 hour free trial)', value: 'lft' },
          { name: '📅 Day (24 hours)',           value: 'day' },
          { name: '📆 Week (7 days)',             value: 'week' },
          { name: '🗓️ Month (30 days)',            value: 'month' },
        )
    )
    .addIntegerOption(opt =>
      opt.setName('amount')
        .setDescription('How many keys to generate (1-50)')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(50)
    ),

  new SlashCommandBuilder()
    .setName('deletekey')
    .setDescription('[ADMIN] Revoke/delete a key')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(opt =>
      opt.setName('key')
        .setDescription('The key to revoke (e.g. ET-WEEK-AB12CD)')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('users')
    .setDescription('[ADMIN] List active subscribers')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('revoke')
    .setDescription('[ADMIN] Revoke a user\'s access by Discord ID')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(opt =>
      opt.setName('user_id')
        .setDescription('Discord user ID to revoke')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('stats')
    .setDescription('[ADMIN] Show key system stats')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
];

// ── REGISTER COMMANDS ──────────────────────────────────────────────────────
async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
  try {
    console.log('[Bot] Registering slash commands...');
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log('[Bot] Commands registered!');
  } catch (err) {
    console.error('[Bot] Failed to register commands:', err);
  }
}

// ── API HELPERS ────────────────────────────────────────────────────────────
async function apiPost(path, body) {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-token': ADMIN_TOKEN },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function apiGet(path) {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { 'x-admin-token': ADMIN_TOKEN },
  });
  return res.json();
}

async function apiDelete(path) {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'DELETE',
    headers: { 'x-admin-token': ADMIN_TOKEN },
  });
  return res.json();
}

// ── FORMAT DURATION ────────────────────────────────────────────────────────
function formatExpiry(expiresAt) {
  const exp  = new Date(expiresAt);
  const now  = new Date();
  const diff = exp - now;
  if (diff <= 0) return 'Expired';
  const days  = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const mins  = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  if (days > 0)  return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

// ── BOT CLIENT ────────────────────────────────────────────────────────────
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', () => {
  console.log(`[Bot] Logged in as ${client.user.tag}`);
  client.user.setActivity('ET Sniper | /redeem', { type: 3 }); // "Watching"
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  // ── /redeem ──────────────────────────────────────────────────────────────
  if (commandName === 'redeem') {
    await interaction.deferReply({ ephemeral: true });

    const key = interaction.options.getString('key').trim().toUpperCase();

    try {
      const data = await apiPost('/redeem', {
        key,
        discord_id: interaction.user.id,
        username:   interaction.user.username,
        avatar:     interaction.user.displayAvatarURL(),
      });

      if (data.error) {
        const errorMessages = {
          invalid_key:      '❌ That key doesn\'t exist. Double-check and try again.',
          revoked:          '❌ That key has been revoked.',
          already_redeemed: `❌ That key has already been redeemed by someone else.`,
          already_active:   `❌ You already have an active subscription! Time remaining: **${formatExpiry(data.expires_at)}**`,
        };
        const msg = errorMessages[data.error] || `❌ Error: ${data.error}`;
        return interaction.editReply({ content: msg });
      }

      const typeEmoji = { lft: '⚡', day: '📅', week: '📆', month: '🗓️' };
      const embed = new EmbedBuilder()
        .setColor(0x10b981)
        .setTitle('✅ Key Redeemed!')
        .setDescription(`Welcome to ET Sniper!\nYour **${data.type.toUpperCase()}** access is now active.`)
        .addFields(
          { name: '⏳ Expires', value: `<t:${Math.floor(new Date(data.expires_at).getTime() / 1000)}:F>`, inline: true },
          { name: '⏱️ Time Left', value: formatExpiry(data.expires_at), inline: true },
          { name: '📥 Next Step', value: 'Download the app and log in with Discord to start sniping!', inline: false },
        )
        .setFooter({ text: 'ET Free Sniper', iconURL: client.user.displayAvatarURL() })
        .setTimestamp();

      interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error('[Bot] /redeem error:', err);
      interaction.editReply({ content: '❌ Server error. Try again later.' });
    }
  }

  // ── /status ───────────────────────────────────────────────────────────────
  else if (commandName === 'status') {
    await interaction.deferReply({ ephemeral: true });

    try {
      const data = await apiPost('/verify', { discord_id: interaction.user.id });

      if (!data.valid) {
        const reasons = {
          no_subscription: '❌ You don\'t have an active subscription. Redeem a key with `/redeem`.',
          expired:         `❌ Your subscription expired. Redeem a new key with \`/redeem\`.`,
        };
        return interaction.editReply({ content: reasons[data.reason] || '❌ No active subscription.' });
      }

      const embed = new EmbedBuilder()
        .setColor(0x3b82f6)
        .setTitle('✅ Active Subscription')
        .addFields(
          { name: '⏳ Expires', value: `<t:${Math.floor(new Date(data.expires_at).getTime() / 1000)}:F>`, inline: true },
          { name: '⏱️ Time Left', value: formatExpiry(data.expires_at), inline: true },
        )
        .setFooter({ text: 'ET Free Sniper' })
        .setTimestamp();

      interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error('[Bot] /status error:', err);
      interaction.editReply({ content: '❌ Server error. Try again later.' });
    }
  }

  // ── /genkeys (ADMIN) ──────────────────────────────────────────────────────
  else if (commandName === 'genkeys') {
    await interaction.deferReply({ ephemeral: true });

    const type   = interaction.options.getString('type');
    const amount = interaction.options.getInteger('amount') || 1;

    try {
      const data = await apiPost('/admin/keys/generate', { type, amount });

      if (data.error) return interaction.editReply({ content: `❌ ${data.error}` });

      const typeEmoji = { lft: '⚡', day: '📅', week: '📆', month: '🗓️' };
      const keyList = data.keys.map(k => `\`${k}\``).join('\n');

      const embed = new EmbedBuilder()
        .setColor(0xf59e0b)
        .setTitle(`${typeEmoji[type]} ${amount} ${type.toUpperCase()} Key${amount > 1 ? 's' : ''} Generated`)
        .setDescription(keyList)
        .setFooter({ text: 'Share these keys with buyers. Each key is single-use.' })
        .setTimestamp();

      interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error('[Bot] /genkeys error:', err);
      interaction.editReply({ content: '❌ Server error.' });
    }
  }

  // ── /deletekey (ADMIN) ────────────────────────────────────────────────────
  else if (commandName === 'deletekey') {
    await interaction.deferReply({ ephemeral: true });

    const key = interaction.options.getString('key').trim().toUpperCase();

    try {
      const data = await apiDelete(`/admin/keys/${encodeURIComponent(key)}`);

      if (data.error) return interaction.editReply({ content: `❌ ${data.error}` });

      interaction.editReply({ content: `✅ Key \`${key}\` has been revoked.` });
    } catch (err) {
      console.error('[Bot] /deletekey error:', err);
      interaction.editReply({ content: '❌ Server error.' });
    }
  }

  // ── /users (ADMIN) ────────────────────────────────────────────────────────
  else if (commandName === 'users') {
    await interaction.deferReply({ ephemeral: true });

    try {
      const users = await apiGet('/admin/users');
      const active = users.filter(u => u.expires_at && new Date(u.expires_at) > new Date());

      if (!active.length) {
        return interaction.editReply({ content: 'No active subscribers.' });
      }

      const lines = active.slice(0, 20).map(u =>
        `**${u.username}** (\`${u.discord_id}\`) — expires in ${formatExpiry(u.expires_at)}`
      );

      const embed = new EmbedBuilder()
        .setColor(0x6366f1)
        .setTitle(`👥 Active Subscribers (${active.length})`)
        .setDescription(lines.join('\n'))
        .setTimestamp();

      interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error('[Bot] /users error:', err);
      interaction.editReply({ content: '❌ Server error.' });
    }
  }

  // ── /revoke (ADMIN) ───────────────────────────────────────────────────────
  else if (commandName === 'revoke') {
    await interaction.deferReply({ ephemeral: true });

    const userId = interaction.options.getString('user_id').trim();

    try {
      const data = await apiDelete(`/admin/users/${userId}`);

      if (data.error) return interaction.editReply({ content: `❌ ${data.error}` });

      interaction.editReply({ content: `✅ Access revoked for user ID \`${userId}\`.` });
    } catch (err) {
      console.error('[Bot] /revoke error:', err);
      interaction.editReply({ content: '❌ Server error.' });
    }
  }

  // ── /stats (ADMIN) ────────────────────────────────────────────────────────
  else if (commandName === 'stats') {
    await interaction.deferReply({ ephemeral: true });

    try {
      const data = await apiGet('/admin/stats');

      const embed = new EmbedBuilder()
        .setColor(0x10b981)
        .setTitle('📊 Key System Stats')
        .addFields(
          { name: '🔑 Total Keys',    value: String(data.total_keys),   inline: true },
          { name: '✅ Used Keys',     value: String(data.used_keys),    inline: true },
          { name: '🗑️ Revoked Keys',  value: String(data.revoked_keys), inline: true },
          { name: '👥 Active Users',  value: String(data.active_users), inline: true },
        )
        .setTimestamp();

      interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error('[Bot] /stats error:', err);
      interaction.editReply({ content: '❌ Server error.' });
    }
  }
});

// ── START ─────────────────────────────────────────────────────────────────
registerCommands().then(() => {
  client.login(BOT_TOKEN);
});
