const Discord = require("discord.js");
const { joinVoiceChannel, createAudioPlayer, createAudioResource, createReadStream, AudioPlayerStatus, VoiceConnectionStatus, entersState, StreamType  } = require('@discordjs/voice');
const { prefix, token } = require("./config.json");
const playdl = require('play-dl')
const emojiCharacters = require('./emoji');
const inverseEmojiCharacters = require('./inverse_emoji');

const client = new Discord.Client({intents: ["GUILDS", "GUILD_MESSAGES", 'GUILD_VOICE_STATES', 'GUILD_MESSAGE_REACTIONS']});
client.login(token);
const queue = new Map();

client.once("ready", () => {
    console.log("Ready!");
});

client.once("reconnecting", () => {
    console.log("Reconnecting!");
});

client.once("disconnect", () => {
    console.log("Disconnect!");
});

client.on("message", async message => {
    if (message.author.bot) return;
    if (!message.content.startsWith(prefix)) return;

    const serverQueue = queue.get(message.guild.id);

    if (message.content.startsWith(`${prefix}play`)) {
        execute(message, serverQueue);
        return;
    } else if (message.content.startsWith(`${prefix}skip`)) {
        skip(message, serverQueue, message.guild);
        return;
    } else if (message.content.startsWith(`${prefix}stop`)) {
        stop(message, serverQueue, message.guild);
        return;
    } else if (message.content.startsWith(`${prefix}queue`)) {
        display_queue(message, serverQueue);
        return;
    } else if (message.content.startsWith(`${prefix}pause`)) {
        serverQueue.player.pause();
        return;
    } else if (message.content.startsWith(`${prefix}unpause`)) {
        serverQueue.player.unpause();
        return;
    } else {
        message.reply("You need to enter a valid command!");
    }
});

async function execute(message, serverQueue) {
    let user_id = message.author.id
    const args = message.content.split(" ");

    const voiceChannel = message.member.voice.channel;
    if (!voiceChannel)
        return message.reply(
            "You need to be in a voice channel to play music!"
        );
    const permissions = voiceChannel.permissionsFor(message.client.user);
    if (!permissions.has("CONNECT") || !permissions.has("SPEAK")) {
        return message.reply(
            "I need the permissions to join and speak in your voice channel!"
        );
    }
    let song;
    try {
        let url = args[1]
        if (!args[1].startsWith('https')) {
            let search_words = message.content.split('play')[1]
            song = await playdl.search(search_words, {
                limit: 5
            })
            const exampleEmbed = new Discord.MessageEmbed()
                .setTitle('Выберите песню')

            let search_results = ''

            for (var i = 0; i < song.length; i++)
            {
                search_results += `\`${i+1}.\` [${song[i].title}](${song[i].url})[${song[i].durationRaw}]\n`
            }



            exampleEmbed.addField(
                '\u200B',
                search_results,
                false)

             let new_msg = await message.reply({ embeds: [exampleEmbed] })

                filter_list = []
                for (var i = 0; i < song.length; i++) {
                    filter_list.push(emojiCharacters[i+1])
                }
                const filter = (reaction, user) => {
                    return filter_list.includes(reaction.emoji.name) && user.id === message.author.id;
                };
                let reactionPromise = new Promise((resolve, reject) => {
                new_msg.awaitReactions({ filter, max: 1, time: 100000, errors: ['time'] })
                    .then(collected => {
                        const reaction = collected.first();
                        song = song[inverseEmojiCharacters[reaction.emoji.name] - 1]
                        resolve(song.url)
                    })
                    .catch(collected => {
                        message.reply('Вы не выбрали песню');
                        resolve(false)
                    })});
                for (var i = 0; i < song.length; i++) {
                    await new_msg.react(emojiCharacters[i+1]);
                }
                url = await reactionPromise


        }
        if (!url)
            return;


        song = await playdl.video_info(url)

    }
    catch (err)
    {
        console.log(err)
        return message.reply('err');
    }


    if (!serverQueue) {
        const queueContruct = {
            textChannel: message.channel,
            voiceChannel: voiceChannel,
            connection: null,
            player: null,
            songs: [],
            volume: 5,
            playing: true,
            player_listeners_set: false
        };

        queue.set(message.guild.id, queueContruct);

        queueContruct.songs.push(song);

        try {
            const player = createAudioPlayer()
            let connection =joinVoiceChannel(
                {
                    channelId: message.member.voice.channel.id,
                    guildId: message.guild.id,
                    adapterCreator: message.guild.voiceAdapterCreator
                });
            connection.on(VoiceConnectionStatus.Disconnected, async (oldState, newState) => {
                try {
                    await Promise.race([
                        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
                        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
                        entersState(connection, VoiceConnectionStatus.Ready , 5_000),
                    ]);
                    // Seems to be reconnecting to a new channel - ignore disconnect
                } catch (error) {
                    console.log('disconnected')
                    // Seems to be a real disconnect which SHOULDN'T be recovered from
                    queue.delete(message.guild.id);
                    connection.destroy();
                }
            });
            connection.subscribe(player)
            queueContruct.connection = connection;
            queueContruct.player = player;

            play(message.guild, queueContruct.songs[0]);
        } catch (err) {
            console.log(err);
            queue.delete(message.guild.id);
            return message.channel.send(err);
        }
    } else {
        serverQueue.songs.push(song);
        return message.channel.send(`${song.video_details.title} has been added to the queue!`);
    }
}

function display_queue(message, serverQueue) {
    if(!serverQueue)
        return message.reply('Очередь пуста');
    const exampleEmbed = new Discord.MessageEmbed()
        .setTitle('Очередь')
    exampleEmbed.addField(
        "Сейчас играет",
        serverQueue.songs[0].video_details.title,
        false
    )
    let next = 'Пусто'

    if(serverQueue.songs.length > 1)
    {
        next = ''
        for (var i = 1; i < serverQueue.songs.length; i++)
        {
            next += `${i}. ${serverQueue.songs[i].video_details.title} \n`
        }


    }
    exampleEmbed.addField(
        "Далее",
        next,
        false)

    message.reply({ embeds: [exampleEmbed] })

}

function skip(message, serverQueue, guild) {
    if (!serverQueue)
    {return message.reply("Нет песен в очереди");}
    serverQueue.songs.shift();
    play(guild, serverQueue.songs[0])

}

function stop(message, serverQueue, guild) {

    if (!serverQueue)
        return message.reply("There is no song that I could stop!");

    serverQueue.songs = [];
    //serverQueue.player.stop();
    serverQueue.player.stop();
    queue.delete(guild.id);
}

async function play(guild, song) {
    const serverQueue = queue.get(guild.id);
    if (!song) {
        //serverQueue.connection.destroy();
        try {
            serverQueue.player.stop();
        }
        catch (err){}
        queue.delete(guild.id);
        return;
    }
    let stream = await playdl.stream_from_info(song, {precache: 10, quality: 2})
    let resource = createAudioResource(stream.stream, {
        inputType: stream.type
    })
    serverQueue.player.play(resource)

    if (!serverQueue.player_listeners_set)
    {
        serverQueue.player.on('error', error => {
            console.error(error);
        });
        serverQueue.player.on(AudioPlayerStatus.Idle, () => {
            serverQueue.songs.shift();
            play(guild, serverQueue.songs[0])
        });
        serverQueue.player_listeners_set = true;
    }

    serverQueue.textChannel.send(`Start playing: **${song.video_details.title}**`);
}


