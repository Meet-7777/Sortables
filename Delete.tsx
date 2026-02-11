import React, {
  useState,
  useCallback,
  useRef,
  useEffect,
  memo,
  useMemo,
} from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  InteractionManager,
} from 'react-native';
import { observer, useObservable, useSelector } from '@legendapp/state/react';
import type { Observable } from '@legendapp/state';
import type { MarketWatchStackScreenProps } from '../../navigation/types';
import {
  marketWatchStore,
  type MarketWatchItem,
  setData,
} from '../../store/marketwatch';
import { useTheme } from '../../hooks/useTheme';
import { useThemedStyles } from '../../hooks/useThemedStyles';
import { type ThemeColors } from '../../store/themeStore';
import { authStore } from '../../store/authStore';
import {
  rearrangeWatchlist,
  bulkDeleteFromWatchlist,
} from '../../api/watchlist';
import { GripVertical, Trash2, Save } from 'lucide-react-native';
import CustomModal from '../../components/CustomModal';
import Sortable from 'react-native-sortables';
import Animated, { useAnimatedRef } from 'react-native-reanimated';

type Props = MarketWatchStackScreenProps<'Delete'>;

const DeleteRow = memo(
  ({
    item,
    isMarked,
    onToggle,
    theme,
  }: {
    item: MarketWatchItem;
    isMarked: boolean;
    onToggle: () => void;
    theme: ThemeColors;
  }) => {
    return (
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 16,
          paddingVertical: 12,
          borderBottomWidth: 1,
          backgroundColor: isMarked ? theme.negativeLight : theme.card,
          borderBottomColor: theme.border,
          opacity: isMarked ? 0.6 : 1,
        }}
      >
        <Sortable.Touchable style={{ padding: 8, marginRight: 8 }}>
          <GripVertical size={20} color={theme.textSecondary} />
        </Sortable.Touchable>

        <View style={{ flex: 1 }}>
          <Text
            style={{
              fontSize: 16,
              fontWeight: '600',
              marginBottom: 2,
              color: theme.text,
            }}
            numberOfLines={1}
          >
            {item.symbol || 'N/A'}
          </Text>
          <Text
            style={{ fontSize: 13, color: theme.textSecondary }}
            numberOfLines={1}
          >
            {item.name || ''}
          </Text>
        </View>

        <Pressable
          style={{
            padding: 12,
            borderRadius: 6,
            minWidth: 36,
            minHeight: 36,
            justifyContent: 'center',
            alignItems: 'center',
            backgroundColor: isMarked ? theme.negative : theme.border,
          }}
          onPress={onToggle}
          hitSlop={10}
          unstable_pressDelay={0}
        >
          <Trash2 size={18} color={isMarked ? '#fff' : theme.textSecondary} />
        </Pressable>
      </View>
    );
  },
  (prevProps, nextProps) => {
    return (
      prevProps.item.token === nextProps.item.token &&
      prevProps.isMarked === nextProps.isMarked &&
      prevProps.theme === nextProps.theme
    );
  },
);

DeleteRow.displayName = 'DeleteRow';

// Observer wrapper that only subscribes to specific token's delete state
const DeleteRowObserver = observer(
  ({
    item,
    deleteMap,
    theme,
  }: {
    item: MarketWatchItem;
    deleteMap: Observable<Record<string, boolean>>;
    theme: ThemeColors;
  }) => {
    const token = item.token || '';
    const isMarked = deleteMap[token]?.get() ?? false;

    const toggle = useCallback(() => {
      deleteMap[token]?.set(!isMarked);
    }, [deleteMap, token, isMarked]);

    return (
      <DeleteRow
        item={item}
        isMarked={isMarked}
        onToggle={toggle}
        theme={theme}
      />
    );
  },
);

export default function Delete({ route, navigation }: Props) {
  const { watchlistId } = route.params;

  const [stocks, setStocks] = useState<MarketWatchItem[]>([]);
  const [isReady, setIsReady] = useState(false);
  const scrollableRef = useAnimatedRef<Animated.ScrollView>();
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);

  const deleteMap = useObservable<Record<string, boolean>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [errorModal, setErrorModal] = useState({
    visible: false,
    title: '',
    message: '',
  });

  const showError = useCallback((title: string, message: string) => {
    setErrorModal({ visible: true, title, message });
  }, []);

  const selectedCount = useSelector(
    () => Object.values(deleteMap.get()).filter(Boolean).length,
  );

  const lastOrderRef = useRef<string[]>([]);

  // Memoize stocks to prevent unnecessary re-renders
  const memoizedStocks = useMemo(() => stocks, [stocks]);

  useEffect(() => {
    // Wait for navigation animation to complete before loading heavy list
    const task = InteractionManager.runAfterInteractions(() => {
      const initialData =
        marketWatchStore.watchlists[watchlistId]?.peek()?.data || [];
      setStocks(initialData);
      lastOrderRef.current = initialData.map(s => s.token || '');
      setIsReady(true);
    });

    return () => {
      task.cancel();
      setStocks([]);
      setIsReady(false);
      deleteMap.set({});
    };
  }, [watchlistId, deleteMap]);

  const onDragEnd = useCallback(
    async ({ data: newOrder }: { data: MarketWatchItem[] }) => {
      const newTokens = newOrder.map(s => s.token || '');
      const hasChanged = newTokens.some(
        (t, i) => t !== lastOrderRef.current[i],
      );

      if (!hasChanged) return;

      setStocks(newOrder);
      lastOrderRef.current = newTokens;

      try {
        const username = authStore.username.peek();
        await rearrangeWatchlist(watchlistId, newTokens, username);
        setData(watchlistId, newOrder);
      } catch (error) {
        console.error('Error rearranging:', error);
      }
    },
    [watchlistId],
  );

  const handleSave = useCallback(async () => {
    const itemsToDelete = Object.entries(deleteMap.peek())
      .filter(([_, value]) => value)
      .map(([key]) => key);

    if (isSaving || itemsToDelete.length === 0) return;

    setIsSaving(true);
    try {
      const username = authStore.username.peek();
      await bulkDeleteFromWatchlist(watchlistId, itemsToDelete, username);

      const deleteSet = new Set(itemsToDelete);
      const updated = stocks.filter(s => !deleteSet.has(s.token || ''));
      setStocks(updated);
      setData(watchlistId, updated);
      lastOrderRef.current = updated.map(s => s.token || '');
      deleteMap.set({});
      navigation.goBack();
    } catch (error) {
      console.error('Error deleting:', error);
      showError('Error', 'Failed to delete items');
    } finally {
      setIsSaving(false);
    }
  }, [isSaving, deleteMap, stocks, watchlistId, navigation, showError]);

  const renderItem = useCallback(
    ({ item }: { item: MarketWatchItem }) => {
      return (
        <DeleteRowObserver item={item} deleteMap={deleteMap} theme={theme} />
      );
    },
    [deleteMap, theme],
  );

  const keyExtractor = useCallback(
    (item: MarketWatchItem) => item.token || '',
    [],
  );

  return (
    <>
      <View style={styles.container}>
        <View style={styles.header}>
          {selectedCount > 0 && (
            <Pressable
              style={({ pressed }) =>
                pressed ? styles.saveButtonPressed : styles.saveButton
              }
              onPress={handleSave}
              disabled={isSaving}
            >
              <Save size={18} color="#fff" />
              <Text style={styles.saveText}>
                {isSaving ? 'Saving...' : 'Save'}
              </Text>
            </Pressable>
          )}
        </View>

        {!isReady ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>Loading...</Text>
          </View>
        ) : stocks.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No items in this watchlist</Text>
          </View>
        ) : (
          <Animated.ScrollView ref={scrollableRef} removeClippedSubviews={true}>
            <Sortable.Grid
              keyExtractor={keyExtractor}
              onDragEnd={onDragEnd}
              columns={1}
              data={memoizedStocks}
              renderItem={renderItem}
              rowGap={0}
              scrollableRef={scrollableRef}
              autoScrollEnabled={true}
              dragActivationDelay={150}
              activationAnimationDuration={200}
              dropAnimationDuration={200}
              overflow="hidden"
            />
          </Animated.ScrollView>
        )}
      </View>

      <CustomModal
        visible={errorModal.visible}
        onClose={() =>
          setErrorModal({ visible: false, title: '', message: '' })
        }
        title={errorModal.title}
        message={errorModal.message}
        type="error"
      />
    </>
  );
}

const createStyles = (theme: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.background,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: 16,
      borderBottomWidth: 1,
      backgroundColor: theme.card,
      borderBottomColor: theme.border,
    },
    saveButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderRadius: 8,
      backgroundColor: theme.positive,
    },
    saveButtonPressed: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderRadius: 8,
      backgroundColor: theme.positive,
      opacity: 0.8,
    },
    saveText: {
      color: '#fff',
      fontSize: 15,
      fontWeight: '600',
    },
    empty: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    emptyText: {
      fontSize: 16,
      color: theme.textSecondary,
    },
  });
