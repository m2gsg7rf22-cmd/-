// Borrowed Shine — ORIGINAL open-world crime mini-arc for the GTA-like blind-test slice.
// Review: node tools/gameforge.mjs story tests/blind/gta-slice/story/borrowed-shine.story.js
//
//   borrowed_shine ──(branch: kept_word | squeezed_lu)── payday (foldback, ending)
// Game code reports: custom 'steal_car' (player enters the gold coupe), custom 'lose_heat'
// (wanted level back to 0) and reach 'halfmoon' (drop-off garage).

export default {
  id: 'borrowed-shine',
  title: 'Borrowed Shine',
  premise: 'A broke courier who swore off crime must steal a councilman\'s gold coupe for the fixer who saved his life, and decide whether a favour repaid is worth more than a fair price.',
  logline: 'One car, one favour, one city that never forgets who drove it.',
  themes: ['Is a debt of gratitude ever paid in full?', 'Who owns a favour once it is cashed?'],
  tone: 'Sun-bleached street crime; quick humour; consequences that land in daylight.',

  world: {
    setting: 'Port Solana, a hot harbour city of palm-lined avenues; this slice is Cobalt Row, a dense mixed district of shops and towers.',
    facts: [
      'Cobalt Row runs on cash, scooters and favours owed to Lu Anwen.',
      'Councilman Pryce parks his gold coupe on the street because nobody would dare touch it.',
      'The Halfmoon body shop repaints anything in forty minutes, no questions.',
      'Port Solana police answer gunfire fast and car theft faster on Cobalt Row.',
    ],
    locations: [
      { id: 'taqueria', name: 'Lu\'s Corner Taqueria', desc: 'A street-corner counter where Lu holds court.',
        hooks: ['A jar of IOU slips by the register', 'Two plastic chairs, one always kept for Lu', 'Scooter keys hanging on nails behind the counter'] },
      { id: 'coupe_spot', name: 'Pryce\'s Curb', desc: 'A no-parking curb where the gold coupe sits untouched.',
        hooks: ['A gold coupe parked across two spaces', 'Unpaid parking tickets tucked under the wiper', 'Pedestrians giving the car a wide berth'] },
      { id: 'halfmoon', name: 'Halfmoon Body Shop', desc: 'A paint shop at the edge of the district.',
        hooks: ['Fresh primer drips on the kerb', 'A licence-plate stack sorted by colour', 'Ruiz\'s radio playing old ballads'] },
    ],
  },

  items: {},
  flags: { external: [] },

  characters: [
    { id: 'dez', name: 'Dez Varga', aliases: ['Dez'], role: 'protagonist', player: true,
      want: 'Pay back Lu and walk away clean.', need: 'Accept that he chooses who he owes.', flaw: 'Says yes to anyone who was kind to him once.',
      arc: 'From a courier who cannot refuse Lu to a man who names his own price, or keeps his word on purpose.',
      voice: 'Short sentences, delivery-route slang, jokes when nervous.' },
    { id: 'lu', name: 'Lu Anwen', aliases: ['Lu'], role: 'fixer', main: true, at: 'taqueria',
      want: 'Embarrass Councilman Pryce before the election.', need: 'See that her favours make people small.', flaw: 'Treats kindness as an investment.',
      arc: 'From a patron who collects people to someone who either earns Dez\'s loyalty or loses it.',
      voice: 'Warm, amused, food metaphors, never says thank you.',
      look: { archetype: 'civilian', seed: 12, sex: 0, age: 52, heightCm: 164, hair: 'bun', hairColor: 0x2b2522, skin: 'olive',
        outfit: [{ type: 'shirt', color: 0x2f6f63 }, { type: 'pants', color: 0x2a2a2a }, { type: 'shoes', color: 0x3a2a20 }] },
      barks: ['Eat first, sin after.', 'Everybody on this street owes me lunch.', 'Keep your engine warm, Dez.'] },
    { id: 'ruiz', name: 'Tomas Ruiz', aliases: ['Ruiz'], role: 'mechanic', at: 'halfmoon',
      want: 'Retire to his brother\'s farm with clean hands.', voice: 'Grumbling, slow, talks to cars like old dogs.',
      look: { archetype: 'civilian', seed: 31, sex: 1, age: 58, heightCm: 172, hair: 'short', hairColor: 0x8a8580, beard: 'stubble', skin: 'brown',
        outfit: [{ type: 'tshirt', color: 0x8a8a7a }, { type: 'jeans', color: 0x30343c }, { type: 'boots', color: 0x2a2520 }] },
      barks: ['Forty minutes. Fifty if you talk.', 'Gold is a terrible colour for a getaway.'] },
  ],

  acts: [
    { id: 'act1', title: 'Act I: The Favour', purpose: 'Setup and payoff in one district: the job, the theft, the heat, the choice.',
      missions: [
        { id: 'borrowed_shine', title: 'Borrowed Shine', giver: 'lu', start: 'dialogue',
          summary: 'Lu asks Dez to steal Councilman Pryce\'s gold coupe, shake the police and bring it to the Halfmoon body shop.',
          beats: ['Lu calls in the favour over tacos.', 'Dez breaks into the gold coupe in broad daylight.', 'Witnesses call it in; police swarm Cobalt Row.', 'Dez loses the heat and reaches Halfmoon.', 'Dez decides: keep his word or squeeze Lu for a fair price.'],
          objectives: [
            { id: 'steal', type: 'custom', target: 'steal_car', text: 'Steal the gold coupe' },
            { id: 'heat', type: 'custom', target: 'lose_heat', text: 'Lose the police', after: ['steal'] },
            { id: 'drop', type: 'reach', target: 'halfmoon', text: 'Bring the coupe to Halfmoon', after: ['heat'] },
            { id: 'call', type: 'flag', target: 'coupe_handed', text: 'Hand the coupe to Ruiz', after: ['drop'] },
          ],
          branches: [
            { id: 'word', choice: 'Hand over the keys', flag: 'kept_word', consequence: 'Lu calls the debt paid and treats Dez as a partner at payday.', foldback: 'payday' },
            { id: 'squeeze', choice: 'Demand a fair price', flag: 'squeezed_lu', consequence: 'Lu pays in cash but cuts Dez out of future jobs.', foldback: 'payday' },
          ],
          flags: { kept_word: 'Dez handed the coupe over as a favour', squeezed_lu: 'Dez made Lu pay for the coupe' },
          rewards: { xp: 150 },
          dialogue: [
            { id: 'lu_offer', with: 'lu', when: 'offer', script: `
# start
Lu: Dez. Sit. You look like a man who skipped breakfast and his conscience.
-> reply
# reply
Dez: I deliver tacos now, Lu. Legal tacos.
-> pitch
# pitch
Lu: Pryce parks his gold coupe on my street. Bring it to Ruiz at Halfmoon. Then we are even.
> Even means even. -> accept {do: start borrowed_shine}
> In daylight? Seriously? -> daylight
# daylight
Lu: Daylight is when people stare. Let them. Pryce needs the embarrassment.
> Fine. Last favour. -> accept {do: start borrowed_shine}
# accept
Lu: Good boy. The coupe is two blocks over. Mind the police, they love that car.
-> end` },
            { id: 'lu_wait', with: 'lu', when: 'active', script: `
# start
Lu: The coupe will not drive itself to Ruiz. Go.
-> end` },
            { id: 'ruiz_drop', with: 'ruiz', when: 'active', if: 'quest:borrowed_shine:drop', script: `
# start
Ruiz: Gold. Of course it is gold. Lu said you would bring it for free.
-> choose
# choose
Dez: Did she.
> Keys. We're even now. -> word {do: set kept_word; set coupe_handed}
> Free? Tell Lu it costs two grand. -> squeeze {do: set squeezed_lu; set coupe_handed}
# word
Ruiz: A man of his word. Rare on this street. Go tell her.
-> end
# squeeze
Ruiz: She will pay. She will also remember. Go tell her.
-> end` },
            { id: 'ruiz_early', with: 'ruiz', when: 'active', if: '!quest:borrowed_shine:drop', priority: -1, script: `
# start
Ruiz: No car, no conversation. Forty minutes starts when you park.
-> end` },
          ] },

        { id: 'payday', title: 'Payday', giver: 'lu', requires: ['borrowed_shine'], start: 'auto',
          summary: 'Dez returns to Lu; how she settles depends on whether he kept his word.',
          beats: ['Lu has already heard from Ruiz.', 'She settles the debt her way, and Dez learns what kind of favour it was.'],
          objectives: [ { id: 'settle', type: 'flag', target: 'settled', text: 'Settle up with Lu' } ],
          rewards: { xp: 100 },
          dialogue: [
            { id: 'lu_payday', with: 'lu', when: 'active', script: `
# start
@if: squeezed_lu
@else: partner
-> paid
# partner
Lu: Ruiz says you gave it away. Stupid. Loyal. Sit down, partner, there is more work.
> No more work, Lu. -> out {do: set settled}
> Partner gets a cut. -> in [if kept_word] {do: set settled}
# paid
Lu: Two grand, Dez. You learned to count. Take it, and find another street.
> Worth it. -> out {do: set settled}
> We were never even. -> out {do: set settled}
# in
Lu: Half a cut. Eat something first.
-> end
# out
Lu: The street remembers. So do I.
-> end` },
          ] },
      ] },
  ],

  ending: { missions: ['payday'], title: 'Even', text: 'The coupe is primer grey by sunset. Cobalt Row has a new story about Dez Varga.' },
};
