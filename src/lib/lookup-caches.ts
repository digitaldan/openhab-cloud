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

import type { IOpenhab } from '../types/models';
import { TtlCache } from './ttl-cache';

/**
 * Lookup caches for the proxy hot path.
 *
 * Every proxied request resolves the session's user (passport deserialize) and
 * that user's openHAB (a findOne on the account). MainUI pulls ~90 assets on
 * first load, and in production MongoDB runs on a separate host from the app
 * servers, so uncached that is ~180 round trips to the database for one page.
 *
 * These live in their own module so mutation paths can invalidate without
 * importing the passport or Express middleware that populate them.
 */

const USER_CACHE_TTL_MS = 5 * 1000;
const OPENHAB_CACHE_TTL_MS = 10 * 1000;

/**
 * Session user, keyed by user id.
 *
 * The cached document is shared between concurrent requests as req.user. That
 * is safe because req.user is only ever read - every write goes through a
 * repository keyed by req.user._id. Keep it that way, or cache a copy.
 */
export const userCache = new TtlCache<Express.User>(USER_CACHE_TTL_MS);

/**
 * A user's openHAB, keyed by account id rather than user id so all members of
 * an account share one entry.
 */
export const openhabCache = new TtlCache<IOpenhab>(OPENHAB_CACHE_TTL_MS);

/**
 * Drop a user from the deserialization cache.
 *
 * Call after changing anything the request path reads off req.user - role,
 * group, active, account - so the change is picked up without waiting out the
 * TTL.
 */
export function invalidateUserCache(userId: string): void {
  userCache.delete(userId);
}

/**
 * Drop an account's openHAB lookup.
 *
 * Call when an openHAB is created, deleted, or has its uuid/secret changed.
 */
export function invalidateOpenhabCache(accountId: string): void {
  openhabCache.delete(accountId);
}
