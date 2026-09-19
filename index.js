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
    Routes,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    AttachmentBuilder
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
            return { success: false, message: 'You do not have a Roblox account linked to Bloxlink. Please verify at https://blox.link first.' };
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
// 2. HELPER: GENERATE & DISTRIBUTE TRANSCRIPT
// ==========================================
async function closeTicketAndSendTranscript(channel, guild, closingUser, reason = 'No reason provided') {
    try {
        // Fetch last 100 messages for the transcript
        const messages = await channel.messages.fetch({ limit: 100 });
        const sortedMessages = Array.from(messages.values()).reverse();

        let transcriptText = `==================================================\n`;
        transcriptText += `SOUTH WALES ROLEPLAY - TICKET TRANSCRIPT\n`;
        transcriptText += `Channel: #${channel.name}\n`;
        transcriptText += `Closed By: ${closingUser.tag} (${closingUser.id})\n`;
        transcriptText += `Reason: ${reason}\n`;
        transcriptText += `Date: ${new Date().toLocaleString()}\n`;
        transcriptText += `==================================================\n\n`;

        sortedMessages.forEach(msg => {
            const time = new Date(msg.createdTimestamp).toLocaleString();
            transcriptText += `[${time}] ${msg.author.tag}: ${msg.cleanContent}\n`;
            if (msg.attachments.size > 0) {
                msg.attachments.forEach(att => {
                    transcriptText += `[Attachment] ${att.url}\n`;
                });
            }
        });

        const transcriptBuffer = Buffer.from(transcriptText, 'utf-8');
        const attachment = new AttachmentBuilder(transcriptBuffer, { name: `${channel.name}-transcript.txt` });

        const embed = new EmbedBuilder()
            .setTitle('📄 Support Ticket Closed')
            .setColor('#0052B4')
            .addFields(
                { name: 'Ticket Name', value: channel.name, inline: true },
                { name: 'Closed By', value: `<@${closingUser.id}>`, inline: true },
                { name: 'Reason', value: reason }
            )
            .setTimestamp();

        // 1. Send transcript to Ticket Owner (extracted from channel topic)
        const ownerId = channel.topic?.split('Ticket Owner: ')[1]?.split(' ')[0];
        if (ownerId) {
            try {
                const owner = await guild.members.fetch(ownerId);
                await owner.send({ embeds: [embed], files: [attachment] });
            } catch (err) {
                console.warn(`Could not DM transcript to ticket owner (${ownerId}).`);
            }
        }

        // 2. Send transcript to Server Owner
        try {
            const serverOwner = await guild.fetchOwner();
            if (serverOwner.id !== ownerId) {
                await serverOwner.send({ embeds: [embed], files: [attachment] });
            }
        } catch (err) {
            console.warn(`Could not DM transcript to server owner.`);
        }

        // 3. Send transcript to the Staff Member closing it (if distinct)
        if (closingUser.id !== ownerId && closingUser.id !== guild.ownerId) {
            try {
                await closingUser.send({ embeds: [embed], files: [attachment] });
            } catch (err) {
                console.warn(`Could not DM transcript to closing staff member.`);
            }
        }

        // Delete channel after transcript dispatch
        setTimeout(() => channel.delete().catch(() => {}), 3000);
    } catch (error) {
        console.error('Error generating transcript:', error);
        channel.delete().catch(() => {});
    }
}

// ==========================================
// 3. DISCORD BOT & SLASH COMMANDS
// ==========================================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
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
        .setDescription('Deploys the Roblox verification panel')
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
                { name: 'Support Staff', color: '#e67e22' },
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
                .setTitle('🏴󠁧󠁢󠁷󠁬󠁳󠁿 South Wales RP | Verification')
                .setDescription('Please press **Verify** to verify with Roblox to get started.')
                .setColor('#0052B4');

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('btn_verify_roblox')
                    .setLabel('Verify')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('🛡️')
            );

            await interaction.channel.send({ embeds: [embed], components: [row] });
            return interaction.reply({ content: '✅ Verification panel posted!', ephemeral: true });
        }

        if (commandName === 'setsupport') {
            const embed = new EmbedBuilder()
                .setTitle('🎫 South Wales RP | Support Portal')
                .setDescription('Welcome to the **South Wales Roleplay Support Panel**!\n\nSelect a category from the dropdown menu below to open a ticket with our team.')
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

    // --- Verification & Ticket Buttons ---
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

        // Claim Ticket Button
        if (interaction.customId === 'btn_claim_ticket') {
            const staffRole = interaction.guild.roles.cache.find(r => r.name === 'Support Staff');
            if (staffRole && !interaction.member.roles.cache.has(staffRole.id) && !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
                return interaction.reply({ content: '❌ Only Support Staff can claim tickets.', ephemeral: true });
            }

            const oldEmbed = interaction.message.embeds[0];
            const updatedEmbed = EmbedBuilder.from(oldEmbed).addFields({ name: 'Claimed By', value: `<@${interaction.user.id}>`, inline: true });

            const oldRow = interaction.message.components[0];
            const newRow = new ActionRowBuilder();

            oldRow.components.forEach(comp => {
                if (comp.customId === 'btn_claim_ticket') {
                    newRow.addComponents(
                        ButtonBuilder.from(comp)
                            .setLabel(`Claimed by ${interaction.user.username}`)
                            .setDisabled(true)
                            .setStyle(ButtonStyle.Secondary)
                    );
                } else {
                    newRow.addComponents(ButtonBuilder.from(comp));
                }
            });

            await interaction.update({ embeds: [updatedEmbed], components: [newRow] });
            await interaction.followUp({ content: `📌 <@${interaction.user.id}> has claimed this ticket.` });
        }

        // Close Ticket (Direct)
        if (interaction.customId === 'btn_close_ticket') {
            await interaction.reply({ content: '🔒 Closing ticket and generating transcript...' });
            await closeTicketAndSendTranscript(interaction.channel, interaction.guild, interaction.user, 'Closed by staff');
        }

        // Close Ticket with Reason (Opens Modal)
        if (interaction.customId === 'btn_close_reason_ticket') {
            const modal = new ModalBuilder()
                .setCustomId('modal_close_reason')
                .setTitle('Close Ticket with Reason');

            const reasonInput = new TextInputBuilder()
                .setCustomId('input_close_reason')
                .setLabel('Reason for closing this ticket')
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder('Enter closing reason here...')
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
            await interaction.showModal(modal);
        }
    }

    // --- Modal Submission ---
    if (interaction.isModalSubmit()) {
        if (interaction.customId === 'modal_close_reason') {
            const reason = interaction.fields.getTextInputValue('input_close_reason');
            await interaction.reply({ content: '🔒 Closing ticket and generating transcript...' });
            await closeTicketAndSendTranscript(interaction.channel, interaction.guild, interaction.user, reason);
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

            const staffRole = interaction.guild.roles.cache.find(r => r.name === 'Support Staff');

            const permissionOverwrites = [
                { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles] }
            ];

            if (staffRole) {
                permissionOverwrites.push({
                    id: staffRole.id,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles]
                });
            }

            const channel = await interaction.guild.channels.create({
                name: channelName,
                type: ChannelType.GuildText,
                topic: `Ticket Owner: ${interaction.user.id}`,
                permissionOverwrites
            });

            const embed = new EmbedBuilder()
                .setTitle(`🎫 ${ticketType} Ticket`)
                .setDescription(`Welcome <@${interaction.user.id}>,\n\nThank you for opening a support request. A member of our support team will assist you shortly.\n\n**Category:** ${ticketType}`)
                .setColor('#0052B4');

            const buttonsRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('btn_claim_ticket').setLabel('Claim Ticket').setStyle(ButtonStyle.Primary).setEmoji('📌'),
                new ButtonBuilder().setCustomId('btn_close_ticket').setLabel('Close Ticket').setStyle(ButtonStyle.Danger).setEmoji('🔒'),
                new ButtonBuilder().setCustomId('btn_close_reason_ticket').setLabel('Close with Reason').setStyle(ButtonStyle.Secondary).setEmoji('📝')
            );

            const staffPing = staffRole ? `<@&${staffRole.id}>` : '@Support Staff';
            await channel.send({ content: `${staffPing} | <@${interaction.user.id}>`, embeds: [embed], components: [buttonsRow] });

            return interaction.editReply(`✅ Support ticket created: <#${channel.id}>`);
        }
    }
});

// ==========================================
// 4. RENDER KEEP-ALIVE HTTP SERVER
// ==========================================
const port = process.env.PORT || 10000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('South Wales RP Bot is Online');
}).listen(port, () => {
    console.log(`[HTTP SERVER] Running on port ${port} for Render keep-alive`);
});

// ==========================================
// 5. STARTUP
// ==========================================
client.on('ready', async () => {
    console.log(`[BOT] Connected as ${client.user.tag}`);
    await registerCommands();
});

client.login(process.env.DISCORD_BOT_TOKEN);
