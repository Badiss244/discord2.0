// Discord Countdown Bot
// Displays how much time is left until a target date
// Uses Discord.js v14

const { Client, GatewayIntentBits, EmbedBuilder, ActivityType } = require('discord.js');
const fs = require('fs');
const path = require('path');

// Bot configuration
const config = {
  token: process.env.DISCORD_TOKEN, // ← replace with your Discord bot token
  prefix: '!',
  updateInterval: 60_000, // 1 minute
};

// Create a new client instance with all necessary intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences
  ]
});

// Storage for all countdowns
let countdowns = [];
const COUNTDOWNS_FILE = path.join(__dirname, 'countdowns.json');

// Load existing countdowns from file
function loadCountdowns() {
  try {
    if (fs.existsSync(COUNTDOWNS_FILE)) {
      const data = fs.readFileSync(COUNTDOWNS_FILE, 'utf8');
      countdowns = JSON.parse(data);
      console.log(`Loaded ${countdowns.length} countdown(s) from file.`);
    }
  } catch (err) {
    console.error('Error loading countdowns:', err);
    countdowns = [];
  }
}

// Save countdowns to file
function saveCountdowns() {
  try {
    fs.writeFileSync(COUNTDOWNS_FILE, JSON.stringify(countdowns, null, 2));
    console.log(`Saved ${countdowns.length} countdown(s) to file.`);
  } catch (err) {
    console.error('Error saving countdowns:', err);
  }
}

// Calculate time remaining
function getTimeRemaining(targetDate) {
  const total = targetDate - Date.now();
  if (total <= 0) {
    return { expired: true, total: 0, days: 0, hours: 0, minutes: 0, seconds: 0 };
  }
  const seconds = Math.floor((total / 1000) % 60);
  const minutes = Math.floor((total / 1000 / 60) % 60);
  const hours   = Math.floor((total / (1000 * 60 * 60)) % 24);
  const days    = Math.floor(total / (1000 * 60 * 60 * 24));
  return { expired: false, total, days, hours, minutes, seconds };
}

// Format time remaining into a human-readable string
function formatTimeRemaining(tr) {
  if (tr.expired) return 'This countdown has expired!';
  const parts = [];
  if (tr.days    > 0) parts.push(`${tr.days} day${tr.days !== 1 ? 's' : ''}`);
  if (tr.hours   > 0) parts.push(`${tr.hours} hour${tr.hours !== 1 ? 's' : ''}`);
  if (tr.minutes > 0) parts.push(`${tr.minutes} minute${tr.minutes !== 1 ? 's' : ''}`);
  if (tr.seconds > 0) parts.push(`${tr.seconds} second${tr.seconds !== 1 ? 's' : ''}`);
  return parts.join(', ') || 'Just a moment';
}

// Update a single countdown message; returns false if expired or errored
async function updateCountdownMessage(countdown) {
  try {
    const tr = getTimeRemaining(countdown.targetDate);
    const formatted = formatTimeRemaining(tr);

    const embed = new EmbedBuilder()
      .setColor(tr.expired ? '#ff0000' : '#0099ff')
      .setTitle(`⏱️ ${countdown.name}`)
      .setDescription(tr.expired
        ? 'This countdown has expired!'
        : `Time remaining: **${formatted}**`)
      .setFooter({ text: `Target: ${new Date(countdown.targetDate).toLocaleString()}` })
      .setTimestamp();

    const channel = await client.channels.fetch(countdown.channelId);
    const message = await channel.messages.fetch(countdown.messageId);
    await message.edit({ embeds: [embed] });

    return !tr.expired;
  } catch (err) {
    console.error(`Error updating countdown “${countdown.name}”:`, err);
    return false;
  }
}

// Update all countdowns and prune expired ones
async function updateAllCountdowns() {
  const stillActive = [];
  for (const cd of countdowns) {
    const active = await updateCountdownMessage(cd);
    if (active) stillActive.push(cd);
  }
  if (stillActive.length !== countdowns.length) {
    countdowns = stillActive;
    saveCountdowns();
    updateBotStatus();
  }
}

// Update bot presence to show number of active countdowns
function updateBotStatus() {
  client.user.setActivity(
    `${countdowns.length} countdown${countdowns.length !== 1 ? 's' : ''}`,
    { type: ActivityType.Watching }
  );
}

// When the client is ready
client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}.`);
  loadCountdowns();
  updateBotStatus();
  setInterval(updateAllCountdowns, config.updateInterval);
});

// Message handler
client.on('messageCreate', async message => {
  if (message.author.bot) return;
  if (!message.content.startsWith(config.prefix)) return;

  const args = message.content.slice(config.prefix.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  // ─── Create a countdown ───────────────────────────────────────────────────────
  if (command === 'countdown') {
    // Match: !countdown "Event Name" YYYY-MM-DD [HH:MM[:SS]]
    const fullMatch = message.content.match(
      /^!countdown\s+"([^"]+)"\s+(\d{4}-\d{2}-\d{2})(?:\s+([0-2]?\d:[0-5]\d(?::[0-5]\d)?))?\s*$/
    );
    if (!fullMatch) {
      return message.reply('Usage: `!countdown "Event Name" YYYY-MM-DD [HH:MM:SS]`');
    }

    const [, eventName, datePart, timePart] = fullMatch;
    const [year, month, day] = datePart.split('-').map(Number);
    const [hour = 0, minute = 0, second = 0] = (timePart || '00:00:00').split(':').map(Number);
    const targetDate = new Date(year, month - 1, day, hour, minute, second);

    if (isNaN(targetDate.getTime())) {
      return message.reply('Invalid date—I couldn’t parse that. Please use YYYY-MM-DD [HH:MM:SS]');
    }

    // Build and send the initial embed
    const tr = getTimeRemaining(targetDate);
    const initialDesc = formatTimeRemaining(tr);
    const embed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle(`⏱️ ${eventName}`)
      .setDescription(`Time remaining: **${initialDesc}**`)
      .setFooter({ text: `Target: ${targetDate.toLocaleString()}` })
      .setTimestamp();

    try {
      const countdownMessage = await message.channel.send({ embeds: [embed] });

      // Store it
      countdowns.push({
        name: eventName,
        targetDate: targetDate.getTime(),
        channelId: message.channel.id,
        messageId: countdownMessage.id,
        createdBy: message.author.id,
        createdAt: Date.now()
      });
      saveCountdowns();
      updateBotStatus();

      await message.react('✅');
    } catch (err) {
      console.error('Error creating countdown:', err);
      message.reply(`An error occurred while creating the countdown: ${err.message}`);
    }
  }

  // ─── List all countdowns ───────────────────────────────────────────────────────
  else if (command === 'countdowns') {
    if (countdowns.length === 0) {
      return message.reply('No active countdowns.');
    }

    const embed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle('Active Countdowns')
      .setDescription('Here are all the active countdowns:')
      .setTimestamp();

    countdowns.forEach((cd, i) => {
      const tr = getTimeRemaining(cd.targetDate);
      embed.addFields({
        name: `${i + 1}. ${cd.name}`,
        value: `Time remaining: **${formatTimeRemaining(tr)}**\nTarget: ${new Date(cd.targetDate).toLocaleString()}`
      });
    });

    message.channel.send({ embeds: [embed] });
  }

  // ─── Delete a countdown ────────────────────────────────────────────────────────
  else if (command === 'delcountdown') {
    if (!args[0]) {
      return message.reply('Please specify the index number of the countdown to delete. Use `!countdowns` to see the list.');
    }

    const idx = parseInt(args[0], 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= countdowns.length) {
      return message.reply('Invalid countdown index.');
    }

    const cd = countdowns[idx];
    if (cd.createdBy !== message.author.id && !message.member.permissions.has('ManageMessages')) {
      return message.reply('You can only delete countdowns that you created.');
    }

    countdowns.splice(idx, 1);
    saveCountdowns();
    updateBotStatus();
    message.reply(`Countdown "${cd.name}" has been deleted.`);
  }

  // ─── Help ─────────────────────────────────────────────────────────────────────
  else if (command === 'help') {
    const embed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle('Countdown Bot Help')
      .setDescription('Here are the available commands:')
      .addFields(
        { name: `${config.prefix}countdown "Event Name" YYYY-MM-DD [HH:MM:SS]`, value: 'Create a new countdown for an event' },
        { name: `${config.prefix}countdowns`, value: 'List all active countdowns' },
        { name: `${config.prefix}delcountdown <index>`, value: 'Delete a countdown by its index number' },
        { name: `${config.prefix}help`, value: 'Show this help message' }
      )
      .setFooter({ text: 'Countdown Bot' })
      .setTimestamp();

    message.channel.send({ embeds: [embed] });
  }
});

// Log in to Discord
client.login(config.token);
