require('dotenv').config();
const { 
    Client, 
    GatewayIntentBits, 
    SlashCommandBuilder, 
    PermissionFlagsBits, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    StringSelectMenuBuilder, 
    ChannelType, 
    REST, 
    Routes 
} = require('discord.js');
const axios = require('axios');
const http = require('http');

// ==========================================
// 1. BLOXLINK VERIFICATION SYSTEM
// ==========================================
async function verifyDiscordUser(guildMember) {
    try {
        const discordId = guildMember.user.id;

        const bloxlinkRes = await axios.get(
            `https://api.blox.link/v4/public/guilds/${process.env.DISCORD_GUILD_ID}/discord-to-roblox/${discordId}`,
            { headers: { Authorization: process.env.BLOXLINK_API_KEY || '1e7d2c72-feb7-40c1-baa2-defc69422414' } }
        );

        const robloxId = bloxlinkRes.data?.robloxID;
        if (!robloxId) {
            return { success: false, message: 'No Roblox account linked to this Discord account on Bloxlink.' };
        }

        const robloxRes = await axios.get(`https://users.roblox.com/v1/users/${robloxId}`);
        const robloxUsername = robloxRes.data.name;

        try {
            await guildMember.setNickname(robloxUsername);
        } catch (nickErr) {
            console.warn(`Could not update nickname for ${guildMember.user.tag}`);
        }

        return { success: true, robloxUsername };
    } catch (error) {
        console.error('Verification Error:', error.response?.data || error.message);
        return { success: false, message: 'Failed to verify account via Bloxlink.' };
    }
}

// ==========================================
// 2. DISCORD BOT & SLASH COMMANDS
// ==========================================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const commands = [
    new SlashCommandBuilder()
        .setName('build')
        .setDescription('Builds server roles, categories, text channels, locked staff areas, and voice channels')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
        .setName('setverify')
        .setDescription('Deploys the Bloxlink Roblox verification panel')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
        .setName('setsupport')
        .setDescription('Deploys the South Wales RP support panel')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
];

async function registerCommands() {
    try {
        const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);
        console.log('Registering Slash Commands...');
        await rest.put(
            Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.DISCORD_GUILD_ID),
            { body: commands.map(c => c.toJSON()) }
        );
        console.log('✅ Slash Commands registered successfully!');
    } catch (err) {
        console.error('Command deployment failed:', err);
    }
}

client.on('interactionCreate', async (interaction) => {
    // --- Slash Commands ---
    if (interaction.isChatInputCommand()) {
        const { commandName, guild } = interaction;

        if (commandName === 'build') {
            await interaction.deferReply({ ephemeral: true });

            const roleConfigs = [
                { name: 'Unverified', color: '#808080' },
                { name: 'Verified Civilian', color: '#2ecc71' },
                { name: 'South Wales Police', color: '#3498db' },
                { name: 'South Wales Fire & Rescue', color: '#e74c3c' },
                { name: 'National Highways', color: '#f1c40f' },
                { name: 'Server Staff', color: '#9b59b6' },
                { name: 'Community Bot', color: '#1abc9c' }
            ];

            const roles = {};
            for (const r of roleConfigs) {
                let existingRole = guild.roles.cache.find(role => role.name === r.name);
                if (!existingRole) {
                    existingRole = await guild.roles.create({ name: r.name, color: r.color, reason: 'SWRP Build' });
                }
                roles[r.name] = existingRole;
            }

            const structure = [
                {
                    category: 'WELCOME & VERIFICATION',
                    channels: [
                        { name: 'verify', type: ChannelType.GuildText },
                        { name: 'announcements', type: ChannelType.GuildText },
                        { name: 'rules', type: ChannelType.GuildText }
                    ]
                },
                {
                    category: 'STAFF ONLY 🔒',
                    lockedToStaff: true,
                    channels: [
                        { name: 'staff-chat', type: ChannelType.GuildText },
                        { name: 'staff-announcements', type: ChannelType.GuildText },
                        { name: 'mod-logs', type: ChannelType.GuildText },
                        { name: 'Staff Meeting VC', type: ChannelType.GuildVoice },
                        { name: 'Staff Lounge VC', type: ChannelType.GuildVoice }
                    ]
                },
                {
                    category: 'SUPPORT & TICKETS',
                    channels: [
                        { name: 'support-tickets', type: ChannelType.GuildText },
                        { name: 'Support Waiting VC 1', type: ChannelType.GuildVoice },
                        { name: 'Support Waiting VC 2', type: ChannelType.GuildVoice }
                    ]
                },
                {
                    category: 'CIVILIAN HUB',
                    channels: [
                        { name: 'general-chat', type: ChannelType.GuildText },
                        { name: 'media-sharing', type: ChannelType.GuildText },
                        { name: 'bot-commands', type: ChannelType.GuildText },
                        { name: 'Civilian Lounge 1', type: ChannelType.GuildVoice },
                        { name: 'Civilian Lounge 2', type: ChannelType.GuildVoice }
                    ]
                },
                {
                    category: 'EMERGENCY SERVICES 🚨',
                    channels: [
                        { name: 'police-dispatch', type: ChannelType.GuildText },
                        { name: 'fire-dispatch', type: ChannelType.GuildText },
                        { name: 'highways-control', type: ChannelType.GuildText },
                        { name: 'Police Comms VC', type: ChannelType.GuildVoice },
                        { name: 'Fire & Rescue VC', type: ChannelType.GuildVoice },
                        { name: 'Highways Control VC', type: ChannelType.GuildVoice }
                    ]
                }
            ];

            for (const item of structure) {
                const categoryPermissions = [];

                if (item.lockedToStaff) {
                    categoryPermissions.push(
                        { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                        { id: roles['Server Staff'].id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.SendMessages] }
                    );
                }

                const cat = await guild.channels.create({
                    name: item.category,
                    type: ChannelType.GuildCategory,
                    permissionOverwrites: categoryPermissions
                });

                for (const ch of item.channels) {
                    await guild.channels.create({
                        name: ch.name,
                        type: ch.type,
                        parent: cat.id
                    });
                }
            }

            return interaction.editReply('✅ **Full server infrastructure built successfully!**');
        }

        if (commandName === 'setverify') {
            const embed = new EmbedBuilder()
                .setTitle('🏴󠁧󠁢󠁷󠁬󠁳󠁿 South Wales RP | Roblox Account Verification')
                .setDescription('Welcome to **South Wales Roleplay**!\n\nTo access server channels, please verify your account. Clicking the button below will sync your server nickname with your **Roblox Username** and remove your Unverified role using Bloxlink.')
                .setColor('#0052B4')
                .setFooter({ text: 'South Wales RP • Bloxlink Powered Verification' });

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('btn_verify_roblox')
                    .setLabel('Verify with Roblox')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('🛡️')
            );

            await interaction.channel.send({ embeds: [embed], components: [row] });
            return interaction.reply({ content: '✅ Verification panel posted!', ephemeral: true });
        }

        if (commandName === 'setsupport') {
            const embed = new EmbedBuilder()
                .setTitle('🎫 South Wales RP | Support Portal')
                .setDescription('Welcome to the **South Wales Roleplay Support Panel**!\n\nSelect a category from the dropdown menu below to open a ticket with our team. Please refrain from opening troll tickets or pinging staff within 8 hours of creation.')
                .setColor('#0052B4')
                .setFooter({ text: 'South Wales RP • Support System' });

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('select_support_category')
                .setPlaceholder('Choose a support category...')
                .addOptions([
                    { label: 'Management', description: 'High-level support or management assistance.', value: 'ticket_management', emoji: '👑' },
                    { label: 'Internal Affairs', description: 'Staff reports, complaints, or appeals.', value: 'ticket_ia', emoji: '⚖️' },
                    { label: 'General Support', description: 'General questions and community help.', value: 'ticket_general', emoji: '💬' }
                ]);

            const row = new ActionRowBuilder().addComponents(selectMenu);

            await interaction.channel.send({ embeds: [embed], components: [row] });
            return interaction.reply({ content: '✅ Support ticket panel posted!', ephemeral: true });
        }
    }

    // --- Button Actions ---
    if (interaction.isButton()) {
        if (interaction.customId === 'btn_verify_roblox') {
            await interaction.deferReply({ ephemeral: true });

            const result = await verifyDiscordUser(interaction.member);

            if (result.success) {
                const unverified = interaction.guild.roles.cache.find(r => r.name === 'Unverified');
                const verified = interaction.guild.roles.cache.find(r => r.name === 'Verified Civilian');

                if (unverified && interaction.member.roles.cache.has(unverified.id)) {
                    await interaction.member.roles.remove(unverified);
                }
                if (verified) {
                    await interaction.member.roles.add(verified);
                }

                return interaction.editReply(`✅ **Verified successfully!** Updated nickname to \`${result.robloxUsername}\` and assigned roles.`);
            } else {
                return interaction.editReply(`❌ **Verification Failed:** ${result.message}`);
            }
        }

        if (interaction.customId === 'btn_close_ticket') {
            await interaction.reply({ content: '🔒 Ticket will close in 5 seconds...' });
            setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
        }
    }

    // --- Dropdown Support Ticket Selection ---
    if (interaction.isStringSelectMenu()) {
        if (interaction.customId === 'select_support_category') {
            await interaction.deferReply({ ephemeral: true });

            const categoryMap = {
                'ticket_management': 'Management',
                'ticket_ia': 'Internal Affairs',
                'ticket_general': 'General Support'
            };

            const ticketType = categoryMap[interaction.values[0]] || 'Support';
            const channelName = `ticket-${interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, '')}`;

            const channel = await interaction.guild.channels.create({
                name: channelName,
                type: ChannelType.GuildText,
                permissionOverwrites: [
                    { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                    { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles] }
                ]
            });

            const embed = new EmbedBuilder()
                .setTitle(`🎫 ${ticketType} Ticket`)
                .setDescription(`Welcome <@${interaction.user.id}>,\n\nThank you for opening a support request. A staff member will assist you shortly.\n\n**Category:** ${ticketType}`)
                .setColor('#0052B4');

            const closeBtn = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('btn_close_ticket').setLabel('Close Ticket').setStyle(ButtonStyle.Danger).setEmoji('🔒')
            );

            await channel.send({ embeds: [embed], components: [closeBtn] });
            return interaction.editReply(`✅ Support ticket created: <#${channel.id}>`);
        }
    }
});

// ==========================================
// 3. RENDER KEEP-ALIVE HTTP SERVER
// ==========================================
const port = process.env.PORT || 10000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('South Wales RP Bot is Online');
}).listen(port, () => {
    console.log(`[HTTP SERVER] Running on port ${port} for Render keep-alive`);
});

// ==========================================
// 4. STARTUP
// ==========================================
client.on('ready', async () => {
    console.log(`[BOT] Connected as ${client.user.tag}`);
    await registerCommands();
});

client.login(process.env.DISCORD_BOT_TOKEN);
