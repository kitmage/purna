require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const {
  EndBehaviorType,
  VoiceConnectionStatus,
  entersState,
  joinVoiceChannel
} = require('@discordjs/voice');
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder
} = require('discord.js');
const prism = require('prism-media');

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;
const recordingsRoot = process.env.RECORDINGS_DIR || path.join(process.cwd(), 'recordings');

if (!token || !clientId || !guildId) {
  console.error('Missing env vars. Set DISCORD_TOKEN, DISCORD_CLIENT_ID, and DISCORD_GUILD_ID.');
  process.exit(1);
}

if (!fs.existsSync(recordingsRoot)) {
  fs.mkdirSync(recordingsRoot, { recursive: true });
}

const command = new SlashCommandBuilder()
  .setName('record')
  .setDescription('Start or stop recording in your current voice channel.')
  .addStringOption((option) =>
    option
      .setName('action')
      .setDescription('Choose start or stop')
      .setRequired(true)
      .addChoices(
        { name: 'start', value: 'start' },
        { name: 'stop', value: 'stop' }
      )
  );

const sessions = new Map();

function sanitizeFilename(value) {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function buildRecordingPath(guildIdValue, userId, startedAt) {
  const stamp = new Date(startedAt).toISOString().replace(/[:.]/g, '-');
  const guildFolder = path.join(recordingsRoot, sanitizeFilename(guildIdValue), stamp);
  if (!fs.existsSync(guildFolder)) {
    fs.mkdirSync(guildFolder, { recursive: true });
  }
  return path.join(guildFolder, `${sanitizeFilename(userId)}.ogg`);
}

function getOrCreateUserStream(session, userId) {
  if (session.subscriptions.has(userId)) {
    return session.subscriptions.get(userId);
  }

  const filePath = buildRecordingPath(session.guildId, userId, session.startedAt);
  const opusStream = session.receiver.subscribe(userId, {
    end: {
      behavior: EndBehaviorType.AfterSilence,
      duration: 2_000
    }
  });

  const oggStream = new prism.opus.OggLogicalBitstream({
    opusHead: new prism.opus.OpusHead({
      channelCount: 2,
      sampleRate: 48_000
    }),
    pageSizeControl: {
      maxPackets: 10
    }
  });

  const out = fs.createWriteStream(filePath);
  opusStream.pipe(oggStream).pipe(out);

  const entry = { opusStream, oggStream, out, filePath };
  session.subscriptions.set(userId, entry);
  session.files.add(filePath);

  const cleanup = () => {
    session.subscriptions.delete(userId);
  };

  opusStream.on('error', (error) => {
    console.error(`Audio stream error for user ${userId}:`, error);
  });
  out.on('error', (error) => {
    console.error(`File write error for user ${userId}:`, error);
  });
  out.on('close', cleanup);

  return entry;
}

async function stopSession(guildIdValue) {
  const session = sessions.get(guildIdValue);
  if (!session) {
    return [];
  }

  for (const { opusStream, oggStream, out } of session.subscriptions.values()) {
    opusStream.unpipe(oggStream);
    oggStream.unpipe(out);
    opusStream.destroy();
    oggStream.destroy();
    out.end();
  }

  session.connection.destroy();
  sessions.delete(guildIdValue);

  return Array.from(session.files.values());
}

async function startSession(interaction) {
  const guildMember = interaction.member;
  const guildIdValue = interaction.guildId;
  const voiceChannel = guildMember.voice.channel;

  if (!voiceChannel) {
    await interaction.reply({
      content: 'You must be in a voice channel to start recording.',
      ephemeral: true
    });
    return;
  }

  if (sessions.has(guildIdValue)) {
    await interaction.reply({
      content: 'I am already recording in this server. Use `/record action:stop` first.',
      ephemeral: true
    });
    return;
  }

  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: guildIdValue,
    adapterCreator: interaction.guild.voiceAdapterCreator,
    selfDeaf: false
  });

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
  } catch (error) {
    connection.destroy();
    console.error('Voice connection failed:', error);
    await interaction.reply({
      content: 'I could not join that voice channel. Check my permissions and try again.',
      ephemeral: true
    });
    return;
  }

  const receiver = connection.receiver;
  const session = {
    guildId: guildIdValue,
    channelId: voiceChannel.id,
    startedAt: Date.now(),
    connection,
    receiver,
    subscriptions: new Map(),
    files: new Set()
  };

  receiver.speaking.on('start', (userId) => {
    getOrCreateUserStream(session, userId);
  });

  connection.on('stateChange', (_, newState) => {
    if (newState.status === VoiceConnectionStatus.Disconnected) {
      stopSession(guildIdValue).catch((err) => {
        console.error('Error while stopping disconnected session:', err);
      });
    }
  });

  sessions.set(guildIdValue, session);

  await interaction.reply({
    content: `Started recording in **${voiceChannel.name}**. Use "/record action:stop" when finished.`,
    ephemeral: true
  });
}

async function stopFromInteraction(interaction) {
  const guildIdValue = interaction.guildId;
  const files = await stopSession(guildIdValue);

  if (files.length === 0) {
    await interaction.reply({
      content: 'I am not currently recording in this server.',
      ephemeral: true
    });
    return;
  }

  const display = files.map((filePath) => `• ${path.relative(process.cwd(), filePath)}`).join('\n');

  await interaction.reply({
    content: `Stopped recording. Files written:\n${display}`,
    ephemeral: true
  });
}

async function registerCommand() {
  const rest = new REST({ version: '10' }).setToken(token);
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
    body: [command.toJSON()]
  });
  console.log(`Registered /record command for guild ${guildId}`);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates]
});

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag} (Purna is listening).`);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) {
    return;
  }

  if (interaction.commandName !== 'record') {
    return;
  }

  const action = interaction.options.getString('action', true);

  if (action === 'start') {
    await startSession(interaction);
    return;
  }

  if (action === 'stop') {
    await stopFromInteraction(interaction);
  }
});

client.on('error', (error) => {
  console.error('Discord client error:', error);
});

process.on('SIGINT', async () => {
  for (const activeGuildId of Array.from(sessions.keys())) {
    await stopSession(activeGuildId);
  }
  client.destroy();
  process.exit(0);
});

(async () => {
  await registerCommand();
  await client.login(token);
})();
