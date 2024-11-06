const { SlashCommandBuilder } = require('discord.js');
const ms = require('ms');

// In-memory storage to persist expiration times
const roleExpirationTimes = {};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setrole')
        .setDescription('Assign a role to a user for a specific duration')
        .addUserOption(option =>
            option.setName('target')
                .setDescription('User to assign the role')
                .setRequired(true)
        )
        .addRoleOption(option =>
            option.setName('role')
                .setDescription('Role to assign')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('duration')
                .setDescription('Duration format: 1s, 1m, 1h, 1d, or a date (dd/mm/yyyy)')
                .setRequired(true)
        ),
    async execute(interaction) {
        const user = interaction.options.getUser('target');
        const role = interaction.options.getRole('role');
        const durationInput = interaction.options.getString('duration');
        const member = await interaction.guild.members.fetch(user.id);
        const hasRole = member.roles.cache.has(role.id);

        let duration;
        let untilDate;

        if (/\d+[sSmMhHdD]/.test(durationInput)) {
            duration = ms(durationInput.toLowerCase());

            if (hasRole && roleExpirationTimes[`${user.id}_${role.id}`]) {
                return interaction.reply({
                    content: `${user} already has the role ${role}. Do you want to add more time?`,
                    ephemeral: true,
                    components: [
                        {
                            type: 1,
                            components: [
                                {
                                    type: 2,
                                    label: 'Add More Time',
                                    style: 1,
                                    custom_id: `add__time__${user.id}__${role.id}__${duration}`
                                },
                                {
                                    type: 2,
                                    label: 'Cancel',
                                    style: 2,
                                    custom_id: `cancel__add__time`
                                }
                            ]
                        }
                    ]
                });
            } else {
                untilDate = new Date(Date.now() + duration);
            }
        } else if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(durationInput)) {
            const [day, month, year] = durationInput.split('/').map(Number);
            untilDate = new Date(year, month - 1, day, 0, 0, 0);

            if (untilDate < new Date()) {
                return interaction.reply({ content: 'The specified date is in the past. Please provide a future date.', ephemeral: true });
            }

            duration = untilDate - Date.now();
        } else {
            return interaction.reply({ content: 'Invalid duration format. Use 1s, 1m, 1h, 1d, or a date (dd/mm/yyyy).', ephemeral: true });
        }

        const hammerTime = `<t:${Math.floor(untilDate.getTime() / 1000)}:F>`;
        roleExpirationTimes[`${user.id}_${role.id}`] = untilDate;

        if (!hasRole) {
            await member.roles.add(role);
            await interaction.reply({ content: `Set ${role} to ${user} until ${hammerTime}.`, ephemeral: true });
        }

        setLongTimeout(async () => {
            await member.roles.remove(role);
            await interaction.followUp({ content: `The role ${role.name} has been removed from ${user.username}.`, ephemeral: true });
            delete roleExpirationTimes[`${user.id}_${role.id}`];
        }, duration);
    },

    async handleButtonInteraction(interaction) {
        const [action, timeAction, userId, roleId, duration] = interaction.customId.split('__');

        if (!(action === 'add' && timeAction === 'time') && action !== 'cancel') {
            return interaction.update({ content: 'Invalid action in interaction.', components: [] });
        }

        const member = await interaction.guild.members.fetch(userId);
        const role = await interaction.guild.roles.fetch(roleId);

        if (!member || !role) {
            return interaction.update({ content: 'User or role not found.', components: [] });
        }

        if (action === 'add') {
            const additionalTime = parseInt(duration, 10);
            let currentUntilDate = roleExpirationTimes[`${userId}_${roleId}`];

            if (currentUntilDate) {
                currentUntilDate = new Date(currentUntilDate.getTime() + additionalTime);
            } else {
                currentUntilDate = new Date(Date.now() + additionalTime);
            }

            roleExpirationTimes[`${userId}_${roleId}`] = currentUntilDate;
            const hammerTime = `<t:${Math.floor(currentUntilDate.getTime() / 1000)}:F>`;
            await interaction.update({ content: `Added more time to ${role.name} for ${member.user.username}. New expiration: ${hammerTime}`, components: [] });

            const remainingTime = currentUntilDate.getTime() - Date.now();
            setLongTimeout(async () => {
                await member.roles.remove(role);
                await interaction.followUp({ content: `The role ${role.name} has been removed from ${member.user.username}.`, ephemeral: true });
                delete roleExpirationTimes[`${userId}_${roleId}`];
            }, remainingTime);
        } else if (action === 'cancel') {
            await interaction.update({ content: 'Operation cancelled.', components: [] });
        }
    }
};

// Helper function to handle long durations safely
function setLongTimeout(callback, delay) {
    if (delay > 2147483647) {
        setTimeout(() => setLongTimeout(callback, delay - 2147483647), 2147483647);
    } else {
        setTimeout(callback, delay);
    }
}
