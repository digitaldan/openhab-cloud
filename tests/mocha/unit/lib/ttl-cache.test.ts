/*
 * Copyright (c) 2010-2026 Contributors to the openHAB project
 *
 * See the NOTICE file(s) distributed with this work for additional
 * information.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0
 *
 * SPDX-License-Identifier: EPL-2.0
 */

import { expect } from 'chai';
import sinon from 'sinon';
import { TtlCache } from '../../../../src/lib/ttl-cache';

describe('TtlCache', () => {
  let clock: sinon.SinonFakeTimers;

  beforeEach(() => {
    clock = sinon.useFakeTimers();
  });

  afterEach(() => {
    clock.restore();
  });

  it('returns a stored value before it expires', () => {
    const cache = new TtlCache<string>(1000);
    cache.set('a', 'value');

    clock.tick(999);

    expect(cache.get('a')).to.equal('value');
  });

  it('returns undefined once the entry has expired', () => {
    const cache = new TtlCache<string>(1000);
    cache.set('a', 'value');

    clock.tick(1000);

    expect(cache.get('a')).to.be.undefined;
  });

  it('drops an expired entry when it is read', () => {
    const cache = new TtlCache<string>(1000);
    cache.set('a', 'value');

    clock.tick(1000);
    cache.get('a');

    expect(cache.size).to.equal(0);
  });

  it('returns undefined for a key that was never set', () => {
    const cache = new TtlCache<string>(1000);

    expect(cache.get('missing')).to.be.undefined;
  });

  it('refreshes the expiry when a key is set again', () => {
    const cache = new TtlCache<string>(1000);
    cache.set('a', 'first');

    clock.tick(900);
    cache.set('a', 'second');
    clock.tick(900);

    expect(cache.get('a')).to.equal('second');
  });

  it('removes an entry on delete', () => {
    const cache = new TtlCache<string>(1000);
    cache.set('a', 'value');

    cache.delete('a');

    expect(cache.get('a')).to.be.undefined;
  });

  it('removes every entry on clear', () => {
    const cache = new TtlCache<string>(1000);
    cache.set('a', '1');
    cache.set('b', '2');

    cache.clear();

    expect(cache.size).to.equal(0);
  });

  it('evicts the oldest entry when full', () => {
    const cache = new TtlCache<string>(1000, 2);
    cache.set('a', '1');
    cache.set('b', '2');
    cache.set('c', '3');

    expect(cache.get('a')).to.be.undefined;
    expect(cache.get('b')).to.equal('2');
    expect(cache.get('c')).to.equal('3');
    expect(cache.size).to.equal(2);
  });

  it('treats a re-set key as the newest entry for eviction', () => {
    const cache = new TtlCache<string>(1000, 2);
    cache.set('a', '1');
    cache.set('b', '2');
    cache.set('a', '1-again');
    cache.set('c', '3');

    // 'b' is now the oldest, so it goes rather than 'a'
    expect(cache.get('b')).to.be.undefined;
    expect(cache.get('a')).to.equal('1-again');
    expect(cache.get('c')).to.equal('3');
  });

  it('sweeps expired entries that are never read', () => {
    const cache = new TtlCache<string>(1000, 10, 5000);
    cache.set('a', 'value');
    expect(cache.size).to.equal(1);

    clock.tick(5000);

    expect(cache.size).to.equal(0);
  });

  it('leaves unexpired entries in place during a sweep', () => {
    const cache = new TtlCache<string>(10000, 10, 5000);
    cache.set('a', 'value');

    clock.tick(5000);

    expect(cache.size).to.equal(1);
  });
});
