import { describe, it, expect } from 'vitest';
import { LeaseRegistry } from './ownership';

describe('LeaseRegistry', () => {
	it('should add owners correctly', () => {
		const registry = new LeaseRegistry<string, string>();
		registry.addOwner('owner1');
		expect(registry.hasOwner('owner1')).toBe(true);
		expect(registry.hasOwner('owner2')).toBe(false);
	});

	it('should add leases to owners', () => {
		const registry = new LeaseRegistry<string, string>();
		registry.addOwner('owner1');
		
		const added = registry.addLease('owner1', 'lease1');
		expect(added).toBe(true);
		
		const duplicate = registry.addLease('owner1', 'lease1');
		expect(duplicate).toBe(false);
	});

	it('should drop leases from owners', () => {
		const registry = new LeaseRegistry<string, string>();
		registry.addOwner('owner1');
		registry.addLease('owner1', 'lease1');
		
		const dropped = registry.dropLease('owner1', 'lease1');
		expect(dropped).toBe(true);
		
		const notDropped = registry.dropLease('owner1', 'lease1');
		expect(notDropped).toBe(false);
	});

	it('should handle dropOwner correctly', () => {
		const registry = new LeaseRegistry<string, string>();
		registry.addOwner('owner1');
		registry.addLease('owner1', 'lease1');
		registry.addLease('owner1', 'lease2');
		
		const dropped = registry.dropOwner('owner1');
		expect(dropped).toBe(true);
		expect(registry.hasOwner('owner1')).toBe(false);
		
		// Check if lease counts were decremented
		// Since we can't directly check private #leaseCounts, we check if takeEmptyLeases returns them
		const empties = registry.takeEmptyLeases();
		expect(empties.has('lease1')).toBe(true);
		expect(empties.has('lease2')).toBe(true);
	});

	it('should correctly handle takeEmptyLeases', () => {
		const registry = new LeaseRegistry<string, string>();
		registry.addOwner('owner1');
		registry.addLease('owner1', 'lease1');
		registry.dropLease('owner1', 'lease1');
		
		const empties = registry.takeEmptyLeases();
		expect(empties.has('lease1')).toBe(true);
		
		// Calling again should be empty
		const empties2 = registry.takeEmptyLeases();
		expect(empties2.size).toBe(0);
	});

	it('should correctly iterate owner leases', () => {
		const registry = new LeaseRegistry<string, string>();
		registry.addOwner('owner1');
		registry.addLease('owner1', 'lease1');
		registry.addLease('owner1', 'lease2');
		
		const leases = Array.from(registry.iterOwnerLeases('owner1'));
		expect(leases).toContain('lease1');
		expect(leases).toContain('lease2');
		expect(leases.length).toBe(2);
	});

	it('should correctly iterate owners', () => {
		const registry = new LeaseRegistry<string, string>();
		registry.addOwner('owner1');
		registry.addOwner('owner2');
		
		const owners = Array.from(registry.iterOwners());
		expect(owners).toContain('owner1');
		expect(owners).toContain('owner2');
		expect(owners.length).toBe(2);
	});

	it('should handle dropping non-existent owners', () => {
		const registry = new LeaseRegistry<string, string>();
		const dropped = registry.dropOwner('ghost');
		expect(dropped).toBe(false);
	});

	it('should handle dropping leases for non-existent owners', () => {
		const registry = new LeaseRegistry<string, string>();
		const dropped = registry.dropLease('ghost', 'ghost-lease');
		expect(dropped).toBe(false);
	});
});
