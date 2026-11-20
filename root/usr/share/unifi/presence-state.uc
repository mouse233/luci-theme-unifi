// SPDX-License-Identifier: Apache-2.0
// State transitions are independent of the source of positive evidence. Callers
// must validate interface, address and MAC before supplying evidence or failure.
export function create_presence_state() {
	let entries = {};

	function get(id) {
		if (!entries[id]) entries[id] = { status: 'unknown', last_seen: 0, failures: 0, next_probe: 0, generation: 0 };
		return entries[id];
	}

	return {
		get: get,
		reset: function(id) {
			let old = get(id);
			entries[id] = { status: 'unknown', last_seen: 0, failures: 0, next_probe: 0, generation: old.generation + 1 };
		},
		// Forget a device that left the inventory so the table does not grow forever.
		remove: function(id) {
			delete entries[id];
		},
		// An inconclusive probe (command error, unexpected reply) is neither evidence
		// nor a timeout, but it must not be retried on the very next tick.
		postpone: function(id, now) {
			get(id).next_probe = now + 60;
		},
		evidence: function(id, now, wall) {
			let item = get(id);
			item.status = 'online';
			item.last_seen = wall;
			item.failures = 0;
			item.next_probe = now + 60;
			item.generation++;
		},
		failure: function(id, now, generation, automatic) {
			let item = get(id);
			// Ignore failures from probes made obsolete by a newer observation.
			if (!automatic || generation != item.generation) return;
			item.failures++;
			if (item.failures >= 3) item.status = 'offline';
			item.next_probe = now + (item.status == 'offline' ? 120 : 60);
		}
	};
};
