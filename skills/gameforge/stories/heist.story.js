// The Blue Ledger — an ORIGINAL open-world crime mission arc (worked example for references/narrative.md).
// Review:  node tools/gameforge.mjs story skills/gameforge/stories/heist.story.js
// Use in a game:  import story from './story/heist.story.js'; SPEC.story = story;  (composeGame compiles it)
//
// Structure: 3 acts, 9 missions (2 optional branch missions), 5 branch points.
//   cold_engine ─┬─ ghost_wire ──────────────┐
//                └─ collectors ─┬ quiet_money ┴─ inside_man ── regatta ── ledger_weight ── low_tide
//                               └ hard_way ───┘   (foldback on flag collectors_handled)
// Consequences: motive_* (Crane's leverage, epilogue), promised_* (Pell's mood, ending reaction),
// bram_* (guards on alert, Crane's respect), marrow_* (clerk's warmth, unlocks the witness ending).

export default {
  id: 'blue-ledger',
  title: 'The Blue Ledger',
  premise: 'A getaway driver who works alone must join a crew to steal a crime boss\'s bribe ledger — and decide whether the truth inside it is worth more than her brother\'s debt.',
  logline: 'In a drowning port city, the only way to pay a debt is to steal the book it is written in.',
  themes: ['Loyalty you are paid for versus loyalty you choose', 'Truth has a price, and someone else usually pays it'],
  tone: 'Rain-noir with dry humour; grounded violence; warm crew banter against a cold city.',

  world: {
    setting: 'Harrowgate, a tidal port of container cranes, flooded lower streets and neon fish markets, run by one shipping magnate.',
    facts: [
      'Harrowgate floods at spring tide; the lower districts live on stilts and gangways.',
      'Augustin Crane owns the container terminal, the tug fleet and three judges.',
      'Debt markers are written on blue paper; owing Crane is called "wearing blue".',
      'The Lantern Regatta: once a year every boat carries a paper lantern; fireworks start at nine.',
      'The Customs House vault predates electricity; its dial was made by Teo\'s old teacher.',
    ],
    locations: [
      { id: 'kettle_street', name: 'Kettle Street', kind: 'village', at: 'south', houses: 5, desc: 'Noodle stalls under tarps, steam and rain.',
        hooks: ['Ines\'s car parked under a broken awning, blanket on the back seat', 'Blue debt markers pinned to a stall\'s "wall of shame"', 'A noodle stall with two stools, one always kept for Teo'] },
      { id: 'crane_yards', name: 'Crane Yards', kind: 'camp', at: 'east', desc: 'Container stacks, sodium lights, a yard office on stilts.',
        hooks: ['Containers stencilled with Crane\'s heron logo', 'A guard rota chalked on a whiteboard', 'Tyre marks where the last debtor tried to drive away'] },
      { id: 'relay_tower', name: 'Saltline Relay', kind: 'tower', at: 'north', floors: 8, desc: 'A rusting radio mast Pell has turned into a home.',
        hooks: ['Cables strung like laundry', 'Pell\'s hand-painted sign: "nothing here works (on purpose)"', 'Relay chips glinting in puddles below the mast'] },
      { id: 'customs_vault', name: 'Customs House', kind: 'ruins', at: 'west', desc: 'A grand old customs hall, half archive, half fortress.',
        hooks: ['Parcels stamped twice: once by customs, once by Crane', 'Odile\'s window with a child\'s drawing taped inside', 'Service door with fresh oil on its hinges'] },
      { id: 'harbor_mouth', name: 'Harbor Mouth', kind: 'camp', at: 'southwest', desc: 'Where the lantern boats leave the harbor; the escape route.',
        hooks: ['Lantern boats bumping hulls', 'A drawbridge operator asleep in his booth'] },
      { id: 'crane_tower', name: 'Crane Tower', kind: 'tower', at: 'northeast', floors: 14, desc: 'Glass office above the terminal; Crane\'s view of everything he owns.',
        hooks: ['A heron sculpture made of melted debt-marker pins', 'Floor-to-ceiling window overlooking the flooded districts'] },
    ],
  },

  items: {
    blueprint: { name: 'Vault Blueprints' },
    relay_chip: { name: 'Relay Chip' },
    cash_bundle: { name: 'Cash Bundle' },
    ledger: { name: 'The Blue Ledger' },
  },

  characters: [
    { id: 'ines', name: 'Ines Rook', aliases: ['Ines'], role: 'protagonist', player: true,
      want: 'Clear her brother Mika\'s debt to Crane.', need: 'Let other people carry part of the weight.', flaw: 'Never asks for help; leaves before she can be left.',
      arc: 'From lone driver who sleeps in her car to a woman who chooses a crew — and chooses what the ledger is for.',
      voice: 'Clipped, dry, car metaphors, never says please.' },
    { id: 'teo', name: 'Teodor Mallin', aliases: ['Teo'], role: 'mentor', at: 'kettle_street',
      want: 'One last clean score to buy his sister\'s boat.', need: 'Admit his hands are failing.', flaw: 'Pride.',
      arc: 'From "I need a driver, not a partner" to handing the dial to Ines and taking the wheel.',
      voice: 'Slow, old-world courtesy, calls everyone "friend", talks about people as if they were locks.',
      barks: ['Patience opens more doors than dynamite, friend.', 'Eat something. Heists run on noodles.'] },
    { id: 'pell', name: 'Pell Asare', aliases: ['Pell'], role: 'ally', main: true, at: 'relay_tower',
      want: 'Expose Crane\'s ledger to the whole city.', need: 'Learn that people, not causes, pay for the truth.', flaw: 'Treats people as means to a cause.',
      arc: 'From zealot to someone who weighs who gets hurt — and either forgives Ines or learns to.',
      voice: 'Fast, jargon, nervous jokes, sentences that trip over each other.',
      barks: ['Do not touch the blue wire. Or the other blue wire.', 'The grid sings at night. I just hum along.'] },
    { id: 'crane', name: 'Augustin Crane', aliases: ['Crane'], role: 'antagonist', at: 'crane_tower',
      want: 'Keep the port, keep the book, keep everyone wearing blue.', need: 'To be needed rather than feared (he never learns it).', flaw: 'Believes everyone has a price.',
      arc: 'A flat arc tested to breaking: his certainty cracks when Ines names her own price.',
      voice: 'Warm, patient, uses first names, never raises his voice.',
      barks: ['Everyone in Harrowgate works for me. Most of them just don\'t know it yet.'] },
    { id: 'bram', name: 'Bram Hollis', aliases: ['Bram'], role: 'enforcer', at: 'crane_yards',
      want: 'Collect on time and go home to his pigeons.', voice: 'Polite menace; counts out loud.',
      barks: ['I count, Rook. That\'s all I do. I count.'] },
    { id: 'odile', name: 'Odile Marrow', aliases: ['Odile'], role: 'inside contact', at: 'customs_vault',
      want: 'Get her daughter out of Harrowgate.', need: 'Stop waiting for permission.', flaw: 'Obedience.', arc: 'From Crane\'s clerk to the witness who ends him (if trusted).',
      voice: 'Precise, bureaucratic, quietly furious.',
      barks: ['Window closed. Come back with a form.'] },
    { id: 'mika', name: 'Mika Rook', aliases: ['Mika'], role: 'brother', at: 'kettle_street',
      want: 'Be forgiven without having to ask.', voice: 'Earnest, apologetic, sketches on napkins.',
      barks: ['I\'m not gambling. I\'m drawing. Look, it\'s you.'] },
  ],

  acts: [
    { id: 'act1', title: 'Act I — Wearing Blue', purpose: 'Setup: the debt, the job, the crew. Ends when Ines commits to a crew (ghost_wire + collectors).',
      missions: [
        { id: 'cold_engine', title: 'Cold Engine', giver: 'teo', summary: 'Teo pitches the Customs House job. Scout the yards and steal the vault blueprints.',
          beats: ['Rain on Kettle Street; Ines sleeps in her car.', 'Teo pitches the ledger job (inciting incident).', 'Ines chooses her motive: Mika or money.', 'Scout Crane Yards, lift the blueprints.', 'Teo names the third member: Pell.'],
          objectives: [
            { id: 'scout', type: 'reach', target: 'crane_yards', text: 'Scout the Crane Yards' },
            { id: 'plans', type: 'collect', target: 'blueprint', text: 'Steal the vault blueprints', after: ['scout'] },
            { id: 'back', type: 'talk', target: 'teo', text: 'Bring the blueprints to Teo', after: ['plans'] },
          ],
          branches: [
            { id: 'family', choice: 'For Mika\'s debt', flag: 'motive_family', consequence: 'Crane leverages Mika in the finale; Mika thanks her in the epilogue.', foldback: 'ledger_weight' },
            { id: 'money', choice: 'For the cut', flag: 'motive_money', consequence: 'Crane tries to outbid the ledger; Mika hears she did it for money.', foldback: 'ledger_weight' },
          ],
          flags: { motive_family: 'Ines took the job for Mika', motive_money: 'Ines took the job for the money' },
          rewards: { xp: 100, money: 200 },
          dialogue: [
            { id: 'teo_pitch', with: 'teo', when: 'offer', script: `
# start
Teo: Still sleeping in the car, friend? The seats do not recline that far.
-> reply
# reply
Ines: They recline exactly as far as I need.
-> pitch
# pitch
Teo: Customs House vault. Crane keeps a ledger there. Every bribe in Harrowgate, in his own hand.
> Mika's debt is in that book. -> family {do: set motive_family; start cold_engine}
> What's my cut? -> money {do: set motive_money; start cold_engine}
> I drive. I don't steal. -> refuse
# family
Teo: Then we tear out his page together. Scout the Crane Yards first.
-> end
# money
Teo: A third, and the car stays yours. Scout the Crane Yards first.
-> end
# refuse
Teo: Then drive me past the yards tomorrow. Just look. Looking is free.
-> end` },
            { id: 'teo_wait', with: 'teo', when: 'active', script: `
# start
Teo: Yards first, then the blueprints. The vault will not mail us its floor plan.
-> end` },
            { id: 'teo_plans', with: 'teo', when: 'complete', script: `
# start
Teo: Good paper. Steel door, old dial, newer alarm. The alarm is not from my century.
-> pell
# pell
Teo: A kid at the Saltline Relay talks to machines. Pell. Be gentle.
-> gentle
# gentle
Ines: I'm always gentle.
-> parked
# parked
Teo: You are always parked. It is not the same thing.
-> end` },
          ] },

        { id: 'ghost_wire', title: 'Ghost in the Wire', giver: 'pell', requires: ['cold_engine'], summary: 'Recruit Pell, who wants the ledger made public. Gather relay chips to own the grid.',
          beats: ['Ines climbs the Saltline Relay.', 'Pell sets a condition: the ledger goes public.', 'Ines promises — or bargains.', 'Relay chips gathered; the cameras are theirs.'],
          objectives: [
            { id: 'chips', type: 'collect', target: 'relay_chip', count: 3, text: 'Gather relay chips' },
            { id: 'back', type: 'talk', target: 'pell', text: 'Bring the chips to Pell', after: ['chips'] },
          ],
          branches: [
            { id: 'leak', flag: 'promised_leak', consequence: 'Pell trusts Ines; selling the ledger later breaks that promise on screen.', foldback: 'ledger_weight' },
            { id: 'sale', flag: 'promised_sale', consequence: 'Pell stays wary through the regatta.', foldback: 'ledger_weight' },
          ],
          rewards: { xp: 120 },
          dialogue: [
            { id: 'pell_meet', with: 'pell', when: 'offer', script: `
# start
Pell: You're the driver? Teo said you'd be taller. Or nicer.
-> taller
# taller
Ines: Teo lies about both.
-> ask
# ask
Pell: I'll kill the alarm. One condition. The ledger goes public, all of it, the same night.
> Deal. The whole city reads it. -> leak {do: set promised_leak; start ghost_wire}
> We see what it's worth first. -> sale {do: set promised_sale; start ghost_wire}
# leak
Pell: Great. Okay. Three relay chips, scattered round the tower. Bring them and I own the grid.
-> end
# sale
Pell: Wow. Okay. Still need three relay chips. We can argue on the way down.
-> end` },
            { id: 'pell_wait', with: 'pell', when: 'active', script: `
# start
Pell: Three chips. The tower eats the rest when it rains.
-> end` },
            { id: 'pell_done', with: 'pell', when: 'complete', script: `
# start
Pell: Grid's mine. Customs House cameras go dark for six minutes. Six. Not seven.
-> seven
# seven
Ines: I've never needed seven.
-> end` },
          ] },

        { id: 'collectors', title: 'Collectors', giver: 'bram', requires: ['cold_engine'], summary: 'Crane\'s enforcer comes for Mika\'s debt. Pay him off or fight.',
          beats: ['Bram corners Ines in the yards and starts counting.', 'Ines pays with the heist advance — or makes it loud.'],
          objectives: [{ id: 'answer', type: 'flag', target: 'bram_answered', text: 'Answer Bram' }],
          branches: [
            { id: 'pay', flag: 'bram_pay', consequence: 'Ines loses her advance; Crane later respects her as "a person who pays".', foldback: 'inside_man' },
            { id: 'fight', flag: 'bram_fight', consequence: 'Crane doubles the guards on regatta night.', foldback: 'inside_man' },
          ],
          dialogue: [
            { id: 'bram_corner', with: 'bram', when: 'offer', script: `
# start
Bram: Ines Rook. Your brother owes Mister Crane four thousand. I'm told to count to ten.
-> count
# count
Bram: One. Two. Three.
> Take the heist advance. All of it. -> pay {do: set bram_pay; set bram_answered; start collectors; start quiet_money}
> Count faster. -> fight {do: set bram_fight; set bram_answered; start collectors; start hard_way}
# pay
Bram: Sensible. Bring both cash bundles to the yard office.
-> end
# fight
Bram: Four. Boys?
-> end` },
          ] },
      ] },

    { id: 'act2', title: 'Act II — The Inside', purpose: 'Confrontation: the debt is handled one way or another (foldback), the crew needs a way in.',
      missions: [
        { id: 'quiet_money', title: 'Quiet Money', giver: 'bram', optional: true, requires: ['collectors'], requiresFlags: 'bram_pay', summary: 'Bring Bram the cash.',
          beats: ['Ines empties her stash.', 'Bram counts it, exactly.'],
          objectives: [
            { id: 'cash', type: 'collect', target: 'cash_bundle', count: 2, text: 'Collect the cash bundles' },
            { id: 'hand', type: 'talk', target: 'bram', text: 'Pay Bram', after: ['cash'] },
          ],
          rewards: { flags: { collectors_handled: true } },
          dialogue: [
            { id: 'bram_wait', with: 'bram', when: 'active', script: `
# start
Bram: The yard office closes when I say. Bring the bundles.
-> end` },
            { id: 'bram_paid', with: 'bram', when: 'complete', script: `
# start
Bram: Four thousand, exact. Mister Crane will hear that you pay your debts.
> Tell him I bite too. -> end
> Tell him nothing. -> end` },
          ] },
        { id: 'hard_way', title: 'The Hard Way', giver: 'bram', optional: true, requires: ['collectors'], requiresFlags: 'bram_fight', summary: 'Put Bram\'s crew on the ground.',
          beats: ['Three collectors close in among the containers.', 'Bram watches, still counting.'],
          objectives: [
            { id: 'thugs', type: 'kill', target: 'thug', count: 3, text: 'Beat Bram\'s collectors' },
            { id: 'done', type: 'talk', target: 'bram', text: 'Face Bram', after: ['thugs'] },
          ],
          rewards: { flags: { collectors_handled: true } },
          dialogue: [
            { id: 'bram_brawl', with: 'bram', when: 'active', script: `
# start
Bram: Five. Six. They're still standing, Rook.
-> end` },
            { id: 'bram_beaten', with: 'bram', when: 'complete', script: `
# start
Bram: You've made this loud, Rook. Loud travels uphill.
> Then let it climb. -> end
> Tell Crane I'm sorry. -> end` },
          ] },

        { id: 'inside_man', title: 'The Inside Man', giver: 'odile', requires: ['ghost_wire', 'collectors'], requiresFlags: 'collectors_handled', summary: 'Turn Crane\'s customs clerk: threaten her or offer her a way out.',
          beats: ['Ines queues at the customs window without a parcel.', 'Odile reveals Crane holds her daughter\'s papers.', 'Threat or promise.', 'Ines cases the Customs House.'],
          objectives: [
            { id: 'case', type: 'reach', target: 'customs_vault', text: 'Case the Customs House' },
            { id: 'pass', type: 'talk', target: 'odile', text: 'Collect the visitor pass from Odile', after: ['case'] },
          ],
          branches: [
            { id: 'trust', flag: 'marrow_trusted', consequence: 'Odile opens the service door warmly; unlocks the witness ending.', foldback: 'regatta' },
            { id: 'threat', flag: 'marrow_blackmailed', consequence: 'Teo worries she will make a call; the witness ending is closed.', foldback: 'regatta' },
          ],
          dialogue: [
            { id: 'odile_meet', with: 'odile', when: 'offer', script: `
# start
Odile: You're standing in the customs line without a parcel. People notice that.
-> stamp
# stamp
Ines: Crane owns you. I can tell by how you hold the stamp.
-> offer
# offer
Odile: He owns my daughter's papers. What do you want from me?
> The service door. Or Crane hears you talked. -> threat {do: set marrow_blackmailed; start inside_man}
> The service door. And two seats out of town. -> trust {do: set marrow_trusted; start inside_man}
# threat
Odile: Then I'll do it. And I'll hate you quietly, which is how I do everything.
-> end
# trust
Odile: Nobody has offered me a seat before. The door opens at the second firework.
-> end` },
            { id: 'odile_wait', with: 'odile', when: 'active', script: `
# start
Odile: Walk the building once. Count the doors. Then come back to my window.
-> end` },
            { id: 'odile_pass', with: 'odile', when: 'complete', script: `
# start
@if: marrow_trusted
@else: cold
-> warm
# warm
Odile: Visitor pass and the night rota. Second firework, service door. Be careful.
-> end
# cold
Odile: Your pass. Don't come to my window again.
-> end` },
          ] },
      ] },

    { id: 'act3', title: 'Act III — Lanterns', purpose: 'Climax and resolution: the heist, the decision, the cost.',
      missions: [
        { id: 'regatta', title: 'Lantern Regatta', giver: 'teo', requires: ['inside_man'], summary: 'Fireworks at nine. Steal the ledger and get out through the harbor mouth.',
          beats: ['Teo briefs the crew; his hands shake.', 'Cameras die for six minutes.', 'Ines takes the dial; Teo takes the wheel (midpoint reversal of roles).', 'Guards, ledger, escape through the lantern boats.'],
          objectives: [
            { id: 'in', type: 'reach', target: 'customs_vault', text: 'Get into the Customs House' },
            { id: 'book', type: 'collect', target: 'ledger', text: 'Crack the vault and take the ledger', after: ['in'] },
            { id: 'guards', type: 'kill', target: 'grunt', count: 2, text: 'Deal with the vault guards', after: ['in'] },
            { id: 'out', type: 'reach', target: 'harbor_mouth', text: 'Escape through the harbor mouth', after: ['book', 'guards'] },
          ],
          rewards: { xp: 300 },
          dialogue: [
            { id: 'teo_brief', with: 'teo', when: 'offer', script: `
# start
Teo: Lanterns on the water at nine. Every guard will be watching the sky.
-> plan
# plan
@if: marrow_blackmailed
@else: plan_door
-> plan_risk
# plan_risk
Teo: Your clerk sounded frightened on the phone. Frightened people make calls.
-> go
# plan_door
Teo: Your clerk says the service door opens at the second firework. A good friend to have.
-> go
# go
Teo: Well, friend?
> Let's go to work. -> end {do: start regatta}
> Your hands are shaking, Teo. -> hands
# hands
Teo: They shake for coffee. For steel, never. You take the dial tonight. I will drive.
> Deal. Let's go. -> end {do: start regatta}` },
            { id: 'teo_heist', with: 'teo', when: 'active', script: `
# start
@if: bram_fight
@else: calm
-> hot
# hot
Teo: Crane's men are doubled tonight. Someone embarrassed them in the yards.
-> end
# calm
Teo: Ledger first, then the harbor mouth. I keep the engine warm.
-> end` },
            { id: 'pell_heist', with: 'pell', when: 'active', script: `
# start
@if: promised_sale
@else: sure
-> doubt
# doubt
Pell: Cameras die in six minutes. And after, we are still arguing about that ledger.
-> end
# sure
Pell: Cameras die in six minutes. Then the whole city gets a bedtime story.
-> end` },
            { id: 'teo_after', with: 'teo', when: 'complete', script: `
# start
Teo: The dial turned for you like it turned for me, twenty years ago.
-> wheel
# wheel
Ines: You drove like it was tomorrow.
-> end` },
          ] },

        { id: 'ledger_weight', title: 'What the Ledger Weighs', giver: 'crane', requires: ['regatta'], start: 'auto', summary: 'Crane summons Ines to his tower. Leak the ledger, sell it, or hand it to a witness.',
          beats: ['Crane\'s invitation arrives on blue paper.', 'Crane offers her exactly what she wanted (the dark night of the soul).', 'Ines decides what the truth is for.'],
          objectives: [
            { id: 'tower', type: 'reach', target: 'crane_tower', text: 'Go up Crane Tower' },
            { id: 'decide', type: 'flag', target: 'ledger_decided', text: 'Decide the ledger\'s fate', after: ['tower'] },
          ],
          branches: [
            { id: 'leak', flag: 'ending_leak', consequence: 'The city reads everything; Mika\'s debt stays, Crane falls.', foldback: 'low_tide' },
            { id: 'sell', flag: 'ending_sale', consequence: 'Mika walks free; Crane keeps the port; Pell is betrayed if promised.', foldback: 'low_tide' },
            { id: 'witness', flag: 'ending_witness', consequence: 'Odile testifies; slow justice, everyone pays a little.', foldback: 'low_tide' },
          ],
          dialogue: [
            { id: 'crane_offer', with: 'crane', when: 'active', if: 'quest:ledger_weight:tower', script: `
# start
Crane: Ines. Sit. You have my book, and I have your brother's future. Let's be adults.
-> leverage
# leverage
@if: motive_money
@else: mika
-> price
# mika
Crane: Mika's debt, gone. Tonight. Hand me the ledger and he sleeps easy.
-> paid
# price
Crane: You came for money. I have more of it than the ledger does. Name a number.
-> paid
# paid
@if: bram_pay
@else: decide
-> paid_line
# paid_line
Crane: You paid Bram on time. You are a person who pays. I respect that.
-> decide
# decide
Crane: So. What does it weigh?
> Pell's right. Everyone reads it tonight. -> leak {do: set ending_leak; set ledger_decided}
> Take it. Mika walks free. -> sell {do: set ending_sale; set ledger_decided}
> Odile gets it. She'll testify. -> witness [if marrow_trusted] {do: set ending_witness; set ledger_decided}
# leak
Crane: Then you sold yourself for a headline. I hope it keeps you warm.
-> leak_reply
# leak_reply
Ines: It won't. That's fine. I've got a car.
-> end
# sell
Crane: Sensible. The book, please. Mika's page is already burning.
-> sell_reply
# sell_reply
@if: promised_leak
@else: sell_quiet
-> sell_broken
# sell_broken
Ines: Pell is going to hate me. Add it to the list.
-> end
# sell_quiet
Ines: Pleasure doing business. Never call me.
-> end
# witness
Crane: A clerk? Odile Marrow? She stamps parcels.
-> witness_reply
# witness_reply
Ines: She stamped every one of yours. She remembers.
-> end` },
          ] },

        { id: 'low_tide', title: 'Low Tide', giver: 'mika', requires: ['ledger_weight'], start: 'auto', summary: 'Epilogue on Kettle Street: Mika, the morning after.',
          beats: ['Morning after the regatta; the tide is out.', 'Mika tells Ines what the city is saying (the consequence montage).', 'Ines decides whether he gets in the car (the arc lands).'],
          objectives: [{ id: 'home', type: 'talk', target: 'mika', text: 'Find Mika on Kettle Street' }],
          rewards: { xp: 200 },
          dialogue: [
            { id: 'mika_epilogue', with: 'mika', when: 'complete', script: `
# start
@if: ending_leak
@else: check_sale
-> leak
# check_sale
@if: ending_sale
@else: witness
-> sale
# leak
Mika: The ledger's on every screen in Harrowgate. They're arresting harbor police. Harbor police!
-> family
# sale
Mika: Bram came by. He tore up my marker and apologised for the door. Who apologises?
-> family
# witness
@if: ending_witness
@else: family
-> witness_line
# witness_line
Mika: Odile Marrow testified for six hours. The papers call her the Stamp.
-> family
# family
@if: motive_family
@else: money
-> thanks
# thanks
Mika: You did all that for me. You could have just asked me to stop.
-> close
# money
Mika: Teo says you took the job for the cut. I don't believe him.
-> close
# close
> I did ask. You didn't stop. -> end
> Get in the car, Mika. -> end` },
          ] },
      ] },
  ],
  ending: { title: 'Low Tide', text: 'The tide goes out on Harrowgate, and for once the Rooks are not wearing blue.' },
};
