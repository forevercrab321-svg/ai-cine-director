import { ShotIntent, CharacterPresence } from '../../types';

export interface ShotRoutingData {
    intent: ShotIntent;
    presence: CharacterPresence;
    allowCastAnchor: boolean;
    forbiddenEntities: string[];
}

/**
 * Analyzes the raw scene text to heuristically determine 
 * what kind of shot this is and whether a character is likely present.
 */
export function classifyShotIntent(sceneText: string): { intent: ShotIntent, presence: CharacterPresence } {
    const text = (sceneText || '').toLowerCase();

    // 1. Destruction / Disaster 
    if (/(meteor|asteroid|earthquake|tsunami|explosion|volcano|tornado|hurricane|collapse|destroy|obliterate|shatter|debris|rubble|impact)/.test(text)) {
        // If it explicitly mentions people fleeing, it might be a hybrid, but for pure destruction we play it safe
        if (/(people|man|woman|crowd|running|fleeing|screaming|person|boy|girl)/.test(text)) {
            return { intent: 'hybrid', presence: 'background' };
        }
        return { intent: 'destruction', presence: 'none' };
    }

    // 2. Establishing / Pure Environment
    if (/(establishing shot|aerial view|drone shot|landscape|cityscape|skyline|empty street|abandoned|no one around|wilderness|ocean waves)/.test(text)) {
        if (!/(man|woman|person|character|boy|girl)/.test(text)) {
            return { intent: 'establishing', presence: 'none' };
        }
    }

    // 3. Environment Object / Prop
    if (/(insert shot|macro|extreme close-up of|close up of an object|table|chair|sword|gun|phone|letter|screen|dashboard)/.test(text)) {
        if (!/(man|woman|person|character|hand|face|finger)/.test(text)) {
            return { intent: 'prop', presence: 'none' };
        }
    }

    // Default to character shot if we can't rule it out, as most storyboards revolve around actors.
    return { intent: 'character', presence: 'primary' };
}

/**
 * Given the shot intent, returns the strict routing rules.
 * This is the ultimate gatekeeper preventing anchor leak.
 */
export function getRoutingRules(intent: ShotIntent, presence: CharacterPresence, manualOverride?: boolean): ShotRoutingData {

    // If user explicitly toggled "contains character" to true/false in UI, honor it first
    if (manualOverride === false) {
        presence = 'none';
    } else if (manualOverride === true && presence === 'none') {
        presence = 'primary';
        intent = intent === 'destruction' || intent === 'establishing' ? 'hybrid' : 'character';
    }

    let allowCastAnchor = false;
    let forbiddenEntities: string[] = [];

    switch (presence) {
        case 'none':
            allowCastAnchor = false;
            // STRONG LEAK PREVENTION for environments/destruction
            forbiddenEntities = [
                'animals', 'humans', 'people', 'faces', 'mascots',
                'anthropomorphic creatures', 'characters', 'monsters', 'aliens'
            ];
            break;
        case 'optional':
        case 'background':
            // We might allow generic people, but NOT the specific cast anchor so it doesn't try to force a close-up
            allowCastAnchor = false;
            break;
        case 'primary':
            // Standard shot
            allowCastAnchor = true;
            break;
    }

    // Additional destruction safeguards
    if (intent === 'destruction') {
        // Stop it from turning falling asteroids into weird animal shapes
        forbiddenEntities.push('animal shapes', 'faces in clouds', 'creatures in fire');
    }

    return {
        intent,
        presence,
        allowCastAnchor,
        forbiddenEntities
    };
}
