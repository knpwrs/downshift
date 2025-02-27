import React, {
  useRef,
  useCallback,
  useReducer,
  useEffect,
  useLayoutEffect,
} from 'react'
import PropTypes from 'prop-types'
import {isReactNative} from '../is.macro'
import {
  scrollIntoView,
  getState,
  generateId,
  debounce,
  validateControlledUnchanged,
  noop,
  targetWithinDownshift,
} from '../utils'
import setStatus from '../set-a11y-status'

const dropdownDefaultStateValues = {
  highlightedIndex: -1,
  isOpen: false,
  selectedItem: null,
  inputValue: '',
}

function callOnChangeProps(action, state, newState) {
  const {props, type} = action
  const changes = {}

  Object.keys(state).forEach(key => {
    invokeOnChangeHandler(key, action, state, newState)

    if (newState[key] !== state[key]) {
      changes[key] = newState[key]
    }
  })

  if (props.onStateChange && Object.keys(changes).length) {
    props.onStateChange({type, ...changes})
  }
}

function invokeOnChangeHandler(key, action, state, newState) {
  const {props, type} = action
  const handler = `on${capitalizeString(key)}Change`
  if (
    props[handler] &&
    newState[key] !== undefined &&
    newState[key] !== state[key]
  ) {
    props[handler]({type, ...newState})
  }
}

/**
 * Default state reducer that returns the changes.
 *
 * @param {Object} s state.
 * @param {Object} a action with changes.
 * @returns {Object} changes.
 */
function stateReducer(s, a) {
  return a.changes
}

/**
 * Returns a message to be added to aria-live region when item is selected.
 *
 * @param {Object} selectionParameters Parameters required to build the message.
 * @returns {string} The a11y message.
 */
function getA11ySelectionMessage(selectionParameters) {
  const {selectedItem, itemToString: itemToStringLocal} = selectionParameters

  return selectedItem
    ? `${itemToStringLocal(selectedItem)} has been selected.`
    : ''
}

/**
 * Debounced call for updating the a11y message.
 */
const updateA11yStatus = debounce((getA11yMessage, document) => {
  setStatus(getA11yMessage(), document)
}, 200)

// istanbul ignore next
const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' &&
  typeof window.document !== 'undefined' &&
  typeof window.document.createElement !== 'undefined'
    ? useLayoutEffect
    : useEffect

// istanbul ignore next
const useElementIds =
  'useId' in React // Avoid conditional useId call
    ? function useElementIds({
        id,
        labelId,
        menuId,
        getItemId,
        toggleButtonId,
        inputId,
      }) {
        // Avoid conditional useId call
        const reactId = `downshift-${React.useId()}`
        if (!id) {
          id = reactId
        }

        const elementIdsRef = useRef({
          labelId: labelId || `${id}-label`,
          menuId: menuId || `${id}-menu`,
          getItemId: getItemId || (index => `${id}-item-${index}`),
          toggleButtonId: toggleButtonId || `${id}-toggle-button`,
          inputId: inputId || `${id}-input`,
        })

        return elementIdsRef.current
      }
    : function useElementIds({
        id = `downshift-${generateId()}`,
        labelId,
        menuId,
        getItemId,
        toggleButtonId,
        inputId,
      }) {
        const elementIdsRef = useRef({
          labelId: labelId || `${id}-label`,
          menuId: menuId || `${id}-menu`,
          getItemId: getItemId || (index => `${id}-item-${index}`),
          toggleButtonId: toggleButtonId || `${id}-toggle-button`,
          inputId: inputId || `${id}-input`,
        })

        return elementIdsRef.current
      }

function getItemAndIndex(itemProp, indexProp, items, errorMessage) {
  let item, index

  if (itemProp === undefined) {
    if (indexProp === undefined) {
      throw new Error(errorMessage)
    }

    item = items[indexProp]
    index = indexProp
  } else {
    index = indexProp === undefined ? items.indexOf(itemProp) : indexProp
    item = itemProp
  }

  return [item, index]
}

function itemToString(item) {
  return item ? String(item) : ''
}

function isAcceptedCharacterKey(key) {
  return /^\S{1}$/.test(key)
}

function capitalizeString(string) {
  return `${string.slice(0, 1).toUpperCase()}${string.slice(1)}`
}

function useLatestRef(val) {
  const ref = useRef(val)
  // technically this is not "concurrent mode safe" because we're manipulating
  // the value during render (so it's not idempotent). However, the places this
  // hook is used is to support memoizing callbacks which will be called
  // *during* render, so we need the latest values *during* render.
  // If not for this, then we'd probably want to use useLayoutEffect instead.
  ref.current = val
  return ref
}

/**
 * Computes the controlled state using a the previous state, props,
 * two reducers, one from downshift and an optional one from the user.
 * Also calls the onChange handlers for state values that have changed.
 *
 * @param {Function} reducer Reducer function from downshift.
 * @param {Object} initialState Initial state of the hook.
 * @param {Object} props The hook props.
 * @returns {Array} An array with the state and an action dispatcher.
 */
function useEnhancedReducer(reducer, initialState, props) {
  const prevStateRef = useRef()
  const actionRef = useRef()
  const enhancedReducer = useCallback(
    (state, action) => {
      actionRef.current = action
      state = getState(state, action.props)

      const changes = reducer(state, action)
      const newState = action.props.stateReducer(state, {...action, changes})

      return newState
    },
    [reducer],
  )
  const [state, dispatch] = useReducer(enhancedReducer, initialState)
  const propsRef = useLatestRef(props)
  const dispatchWithProps = useCallback(
    action => dispatch({props: propsRef.current, ...action}),
    [propsRef],
  )
  const action = actionRef.current

  useEffect(() => {
    if (action && prevStateRef.current && prevStateRef.current !== state) {
      callOnChangeProps(
        action,
        getState(prevStateRef.current, action.props),
        state,
      )
    }

    prevStateRef.current = state
  }, [state, props, action])

  return [state, dispatchWithProps]
}

/**
 * Wraps the useEnhancedReducer and applies the controlled prop values before
 * returning the new state.
 *
 * @param {Function} reducer Reducer function from downshift.
 * @param {Object} initialState Initial state of the hook.
 * @param {Object} props The hook props.
 * @returns {Array} An array with the state and an action dispatcher.
 */
function useControlledReducer(reducer, initialState, props) {
  const [state, dispatch] = useEnhancedReducer(reducer, initialState, props)

  return [getState(state, props), dispatch]
}

const defaultProps = {
  itemToString,
  stateReducer,
  getA11ySelectionMessage,
  scrollIntoView,
  environment:
    /* istanbul ignore next (ssr) */
    typeof window === 'undefined' ? undefined : window,
}

function getDefaultValue(
  props,
  propKey,
  defaultStateValues = dropdownDefaultStateValues,
) {
  const defaultValue = props[`default${capitalizeString(propKey)}`]

  if (defaultValue !== undefined) {
    return defaultValue
  }

  return defaultStateValues[propKey]
}

function getInitialValue(
  props,
  propKey,
  defaultStateValues = dropdownDefaultStateValues,
) {
  const value = props[propKey]

  if (value !== undefined) {
    return value
  }

  const initialValue = props[`initial${capitalizeString(propKey)}`]

  if (initialValue !== undefined) {
    return initialValue
  }

  return getDefaultValue(props, propKey, defaultStateValues)
}

function getInitialState(props) {
  const selectedItem = getInitialValue(props, 'selectedItem')
  const isOpen = getInitialValue(props, 'isOpen')
  const highlightedIndex = getInitialValue(props, 'highlightedIndex')
  const inputValue = getInitialValue(props, 'inputValue')

  return {
    highlightedIndex:
      highlightedIndex < 0 && selectedItem && isOpen
        ? props.items.indexOf(selectedItem)
        : highlightedIndex,
    isOpen,
    selectedItem,
    inputValue,
  }
}

function getHighlightedIndexOnOpen(props, state, offset) {
  const {items, initialHighlightedIndex, defaultHighlightedIndex} = props
  const {selectedItem, highlightedIndex} = state

  if (items.length === 0) {
    return -1
  }

  // initialHighlightedIndex will give value to highlightedIndex on initial state only.
  if (
    initialHighlightedIndex !== undefined &&
    highlightedIndex === initialHighlightedIndex
  ) {
    return initialHighlightedIndex
  }
  if (defaultHighlightedIndex !== undefined) {
    return defaultHighlightedIndex
  }
  if (selectedItem) {
    return items.indexOf(selectedItem)
  }
  if (offset === 0) {
    return -1
  }
  return offset < 0 ? items.length - 1 : 0
}

/**
 * Reuse the movement tracking of mouse and touch events.
 *
 * @param {boolean} isOpen Whether the dropdown is open or not.
 * @param {Array<Object>} downshiftElementRefs Downshift element refs to track movement (toggleButton, menu etc.)
 * @param {Object} environment Environment where component/hook exists.
 * @param {Function} handleBlur Handler on blur from mouse or touch.
 * @returns {Object} Ref containing whether mouseDown or touchMove event is happening
 */
function useMouseAndTouchTracker(
  isOpen,
  downshiftElementRefs,
  environment,
  handleBlur,
) {
  const mouseAndTouchTrackersRef = useRef({
    isMouseDown: false,
    isTouchMove: false,
  })

  useEffect(() => {
    if (isReactNative || !environment) {
      return
    }

    // The same strategy for checking if a click occurred inside or outside downshift
    // as in downshift.js.
    const onMouseDown = () => {
      mouseAndTouchTrackersRef.current.isMouseDown = true
    }
    const onMouseUp = event => {
      mouseAndTouchTrackersRef.current.isMouseDown = false
      if (
        isOpen &&
        !targetWithinDownshift(
          event.target,
          downshiftElementRefs.map(ref => ref.current),
          environment,
        )
      ) {
        handleBlur()
      }
    }
    const onTouchStart = () => {
      mouseAndTouchTrackersRef.current.isTouchMove = false
    }
    const onTouchMove = () => {
      mouseAndTouchTrackersRef.current.isTouchMove = true
    }
    const onTouchEnd = event => {
      if (
        isOpen &&
        !mouseAndTouchTrackersRef.current.isTouchMove &&
        !targetWithinDownshift(
          event.target,
          downshiftElementRefs.map(ref => ref.current),
          environment,
          false,
        )
      ) {
        handleBlur()
      }
    }

    environment.addEventListener('mousedown', onMouseDown)
    environment.addEventListener('mouseup', onMouseUp)
    environment.addEventListener('touchstart', onTouchStart)
    environment.addEventListener('touchmove', onTouchMove)
    environment.addEventListener('touchend', onTouchEnd)

    // eslint-disable-next-line consistent-return
    return function cleanup() {
      environment.removeEventListener('mousedown', onMouseDown)
      environment.removeEventListener('mouseup', onMouseUp)
      environment.removeEventListener('touchstart', onTouchStart)
      environment.removeEventListener('touchmove', onTouchMove)
      environment.removeEventListener('touchend', onTouchEnd)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, environment])

  return mouseAndTouchTrackersRef
}

/* istanbul ignore next */
// eslint-disable-next-line import/no-mutable-exports
let useGetterPropsCalledChecker = () => noop
/**
 * Custom hook that checks if getter props are called correctly.
 *
 * @param  {...any} propKeys Getter prop names to be handled.
 * @returns {Function} Setter function called inside getter props to set call information.
 */
/* istanbul ignore next */
if (process.env.NODE_ENV !== 'production') {
  useGetterPropsCalledChecker = (...propKeys) => {
    const isInitialMountRef = useRef(true)
    const getterPropsCalledRef = useRef(
      propKeys.reduce((acc, propKey) => {
        acc[propKey] = {}
        return acc
      }, {}),
    )

    useEffect(() => {
      Object.keys(getterPropsCalledRef.current).forEach(propKey => {
        const propCallInfo = getterPropsCalledRef.current[propKey]
        if (isInitialMountRef.current) {
          if (!Object.keys(propCallInfo).length) {
            // eslint-disable-next-line no-console
            console.error(
              `downshift: You forgot to call the ${propKey} getter function on your component / element.`,
            )
            return
          }
        }

        const {suppressRefError, refKey, elementRef} = propCallInfo

        if ((!elementRef || !elementRef.current) && !suppressRefError) {
          // eslint-disable-next-line no-console
          console.error(
            `downshift: The ref prop "${refKey}" from ${propKey} was not applied correctly on your element.`,
          )
        }
      })

      isInitialMountRef.current = false
    })

    const setGetterPropCallInfo = useCallback(
      (propKey, suppressRefError, refKey, elementRef) => {
        getterPropsCalledRef.current[propKey] = {
          suppressRefError,
          refKey,
          elementRef,
        }
      },
      [],
    )

    return setGetterPropCallInfo
  }
}

function useA11yMessageSetter(
  getA11yMessage,
  dependencyArray,
  {isInitialMount, highlightedIndex, items, environment, ...rest},
) {
  // Sets a11y status message on changes in state.
  useEffect(() => {
    if (isInitialMount || isReactNative || !environment?.document) {
      return
    }

    updateA11yStatus(
      () =>
        getA11yMessage({
          highlightedIndex,
          highlightedItem: items[highlightedIndex],
          resultCount: items.length,
          ...rest,
        }),
      environment.document,
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencyArray)
}

function useScrollIntoView({
  highlightedIndex,
  isOpen,
  itemRefs,
  getItemNodeFromIndex,
  menuElement,
  scrollIntoView: scrollIntoViewProp,
}) {
  // used not to scroll on highlight by mouse.
  const shouldScrollRef = useRef(true)
  // Scroll on highlighted item if change comes from keyboard.
  useIsomorphicLayoutEffect(() => {
    if (
      highlightedIndex < 0 ||
      !isOpen ||
      !Object.keys(itemRefs.current).length
    ) {
      return
    }

    if (shouldScrollRef.current === false) {
      shouldScrollRef.current = true
    } else {
      scrollIntoViewProp(getItemNodeFromIndex(highlightedIndex), menuElement)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightedIndex])

  return shouldScrollRef
}

// eslint-disable-next-line import/no-mutable-exports
let useControlPropsValidator = noop
/* istanbul ignore next */
if (process.env.NODE_ENV !== 'production') {
  useControlPropsValidator = ({isInitialMount, props, state}) => {
    // used for checking when props are moving from controlled to uncontrolled.
    const prevPropsRef = useRef(props)

    useEffect(() => {
      if (isInitialMount) {
        return
      }

      validateControlledUnchanged(state, prevPropsRef.current, props)
      prevPropsRef.current = props
    }, [state, props, isInitialMount])
  }
}

/**
 * Handles selection on Enter / Alt + ArrowUp. Closes the menu and resets the highlighted index, unless there is a highlighted.
 * In that case, selects the item and resets to defaults for open state and highlighted idex.
 * @param {Object} props The useCombobox props.
 * @param {number} highlightedIndex The index from the state.
 * @param {boolean} inputValue Also return the input value for state.
 * @returns The changes for the state.
 */
function getChangesOnSelection(props, highlightedIndex, inputValue = true) {
  const shouldSelect = props.items?.length && highlightedIndex >= 0

  return {
    isOpen: false,
    highlightedIndex: -1,
    ...(shouldSelect && {
      selectedItem: props.items[highlightedIndex],
      isOpen: getDefaultValue(props, 'isOpen'),
      highlightedIndex: getDefaultValue(props, 'highlightedIndex'),
      ...(inputValue && {
        inputValue: props.itemToString(props.items[highlightedIndex]),
      }),
    }),
  }
}

// Shared between all exports.
const commonPropTypes = {
  environment: PropTypes.shape({
    addEventListener: PropTypes.func.isRequired,
    removeEventListener: PropTypes.func.isRequired,
    document: PropTypes.shape({
      createElement: PropTypes.func.isRequired,
      getElementById: PropTypes.func.isRequired,
      activeElement: PropTypes.any.isRequired,
      body: PropTypes.any.isRequired,
    }).isRequired,
    Node: PropTypes.func.isRequired,
  }),
  itemToString: PropTypes.func,
  stateReducer: PropTypes.func,
}

// Shared between useSelect, useCombobox, Downshift.
const commonDropdownPropTypes = {
  ...commonPropTypes,
  getA11yStatusMessage: PropTypes.func,
  highlightedIndex: PropTypes.number,
  defaultHighlightedIndex: PropTypes.number,
  initialHighlightedIndex: PropTypes.number,
  isOpen: PropTypes.bool,
  defaultIsOpen: PropTypes.bool,
  initialIsOpen: PropTypes.bool,
  selectedItem: PropTypes.any,
  initialSelectedItem: PropTypes.any,
  defaultSelectedItem: PropTypes.any,
  id: PropTypes.string,
  labelId: PropTypes.string,
  menuId: PropTypes.string,
  getItemId: PropTypes.func,
  toggleButtonId: PropTypes.string,
  onSelectedItemChange: PropTypes.func,
  onHighlightedIndexChange: PropTypes.func,
  onStateChange: PropTypes.func,
  onIsOpenChange: PropTypes.func,
  scrollIntoView: PropTypes.func,
}

export {
  useControlPropsValidator,
  useScrollIntoView,
  useA11yMessageSetter,
  useGetterPropsCalledChecker,
  useMouseAndTouchTracker,
  getHighlightedIndexOnOpen,
  getInitialState,
  getInitialValue,
  getDefaultValue,
  defaultProps,
  useControlledReducer,
  useEnhancedReducer,
  useLatestRef,
  capitalizeString,
  isAcceptedCharacterKey,
  getItemAndIndex,
  useElementIds,
  getChangesOnSelection,
  commonDropdownPropTypes,
  commonPropTypes,
}
