/* eslint camelcase:0 */

import PropTypes from 'prop-types'
import {Component, cloneElement} from 'react'
import {isForwardRef} from 'react-is'
import {isPreact, isReactNative, isReactNativeWeb} from './is.macro'
import setA11yStatus from './set-a11y-status'
import * as stateChangeTypes from './stateChangeTypes'
import {
  handleRefs,
  callAllEventHandlers,
  cbToCb,
  debounce,
  generateId,
  getA11yStatusMessage,
  getElementProps,
  isDOMElement,
  targetWithinDownshift,
  isPlainObject,
  noop,
  normalizeArrowKey,
  pickState,
  requiredProp,
  scrollIntoView,
  unwrapArray,
  getState,
  isControlledProp,
  validateControlledUnchanged,
  getHighlightedIndex,
  getNonDisabledIndex,
} from './utils'

class Downshift extends Component {
  static propTypes = {
    children: PropTypes.func,
    defaultHighlightedIndex: PropTypes.number,
    defaultIsOpen: PropTypes.bool,
    initialHighlightedIndex: PropTypes.number,
    initialSelectedItem: PropTypes.any,
    initialInputValue: PropTypes.string,
    initialIsOpen: PropTypes.bool,
    getA11yStatusMessage: PropTypes.func,
    itemToString: PropTypes.func,
    onChange: PropTypes.func,
    onSelect: PropTypes.func,
    onStateChange: PropTypes.func,
    onInputValueChange: PropTypes.func,
    onUserAction: PropTypes.func,
    onOuterClick: PropTypes.func,
    selectedItemChanged: PropTypes.func,
    stateReducer: PropTypes.func,
    itemCount: PropTypes.number,
    id: PropTypes.string,
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
    suppressRefError: PropTypes.bool,
    scrollIntoView: PropTypes.func,
    // things we keep in state for uncontrolled components
    // but can accept as props for controlled components
    /* eslint-disable react/no-unused-prop-types */
    selectedItem: PropTypes.any,
    isOpen: PropTypes.bool,
    inputValue: PropTypes.string,
    highlightedIndex: PropTypes.number,
    labelId: PropTypes.string,
    inputId: PropTypes.string,
    menuId: PropTypes.string,
    getItemId: PropTypes.func,
    /* eslint-enable react/no-unused-prop-types */
  }

  static defaultProps = {
    defaultHighlightedIndex: null,
    defaultIsOpen: false,
    getA11yStatusMessage,
    itemToString: i => {
      if (i == null) {
        return ''
      }
      if (
        process.env.NODE_ENV !== 'production' &&
        isPlainObject(i) &&
        !i.hasOwnProperty('toString')
      ) {
        // eslint-disable-next-line no-console
        console.warn(
          'downshift: An object was passed to the default implementation of `itemToString`. You should probably provide your own `itemToString` implementation. Please refer to the `itemToString` API documentation.',
          'The object that was passed:',
          i,
        )
      }
      return String(i)
    },
    onStateChange: noop,
    onInputValueChange: noop,
    onUserAction: noop,
    onChange: noop,
    onSelect: noop,
    onOuterClick: noop,
    selectedItemChanged: (prevItem, item) => prevItem !== item,
    environment:
      /* istanbul ignore next (ssr) */
      typeof window === 'undefined' ? undefined : window,
    stateReducer: (state, stateToSet) => stateToSet,
    suppressRefError: false,
    scrollIntoView,
  }

  static stateChangeTypes = stateChangeTypes

  constructor(props) {
    super(props)
    // fancy destructuring + defaults + aliases
    // this basically says each value of state should either be set to
    // the initial value or the default value if the initial value is not provided
    const {
      defaultHighlightedIndex,
      initialHighlightedIndex: highlightedIndex = defaultHighlightedIndex,
      defaultIsOpen,
      initialIsOpen: isOpen = defaultIsOpen,
      initialInputValue: inputValue = '',
      initialSelectedItem: selectedItem = null,
    } = this.props
    const state = this.getState({
      highlightedIndex,
      isOpen,
      inputValue,
      selectedItem,
    })
    if (
      state.selectedItem != null &&
      this.props.initialInputValue === undefined
    ) {
      state.inputValue = this.props.itemToString(state.selectedItem)
    }
    this.state = state
  }

  id = this.props.id || `downshift-${generateId()}`
  menuId = this.props.menuId || `${this.id}-menu`
  labelId = this.props.labelId || `${this.id}-label`
  inputId = this.props.inputId || `${this.id}-input`
  getItemId = this.props.getItemId || (index => `${this.id}-item-${index}`)

  items = []
  // itemCount can be changed asynchronously
  // from within downshift (so it can't come from a prop)
  // this is why we store it as an instance and use
  // getItemCount rather than just use items.length
  // (to support windowing + async)
  itemCount = null
  previousResultCount = 0

  timeoutIds = []

  /**
   * @param {Function} fn the function to call after the time
   * @param {Number} time the time to wait
   */
  internalSetTimeout = (fn, time) => {
    const id = setTimeout(() => {
      this.timeoutIds = this.timeoutIds.filter(i => i !== id)
      fn()
    }, time)

    this.timeoutIds.push(id)
  }

  /**
   * Clear all running timeouts
   */
  internalClearTimeouts() {
    this.timeoutIds.forEach(id => {
      clearTimeout(id)
    })

    this.timeoutIds = []
  }

  /**
   * Gets the state based on internal state or props
   * If a state value is passed via props, then that
   * is the value given, otherwise it's retrieved from
   * stateToMerge
   *
   * @param {Object} stateToMerge defaults to this.state
   * @return {Object} the state
   */
  getState(stateToMerge = this.state) {
    return getState(stateToMerge, this.props)
  }

  getItemCount() {
    // things read better this way. They're in priority order:
    // 1. `this.itemCount`
    // 2. `this.props.itemCount`
    // 3. `this.items.length`
    let itemCount = this.items.length
    if (this.itemCount != null) {
      itemCount = this.itemCount
    } else if (this.props.itemCount !== undefined) {
      itemCount = this.props.itemCount
    }
    return itemCount
  }

  setItemCount = count => {
    this.itemCount = count
  }

  unsetItemCount = () => {
    this.itemCount = null
  }

  getItemNodeFromIndex(index) {
    return this.props.environment
      ? this.props.environment.document.getElementById(this.getItemId(index))
      : null
  }

  isItemDisabled = (_item, index) => {
    const currentElementNode = this.getItemNodeFromIndex(index)

    return currentElementNode && currentElementNode.hasAttribute('disabled')
  }

  setHighlightedIndex = (
    highlightedIndex = this.props.defaultHighlightedIndex,
    otherStateToSet = {},
  ) => {
    otherStateToSet = pickState(otherStateToSet)
    this.internalSetState({highlightedIndex, ...otherStateToSet})
  }

  scrollHighlightedItemIntoView() {
    /* istanbul ignore else (react-native) */
    if (!isReactNative) {
      const node = this.getItemNodeFromIndex(this.getState().highlightedIndex)
      this.props.scrollIntoView(node, this._menuNode)
    }
  }

  moveHighlightedIndex(amount, otherStateToSet) {
    const itemCount = this.getItemCount()
    const {highlightedIndex} = this.getState()
    if (itemCount > 0) {
      const nextHighlightedIndex = getHighlightedIndex(
        highlightedIndex,
        amount,
        {length: itemCount},
        this.isItemDisabled,
        true,
      )
      this.setHighlightedIndex(nextHighlightedIndex, otherStateToSet)
    }
  }

  clearSelection = cb => {
    this.internalSetState(
      {
        selectedItem: null,
        inputValue: '',
        highlightedIndex: this.props.defaultHighlightedIndex,
        isOpen: this.props.defaultIsOpen,
      },
      cb,
    )
  }

  selectItem = (item, otherStateToSet, cb) => {
    otherStateToSet = pickState(otherStateToSet)
    this.internalSetState(
      {
        isOpen: this.props.defaultIsOpen,
        highlightedIndex: this.props.defaultHighlightedIndex,
        selectedItem: item,
        inputValue: this.props.itemToString(item),
        ...otherStateToSet,
      },
      cb,
    )
  }

  selectItemAtIndex = (itemIndex, otherStateToSet, cb) => {
    const item = this.items[itemIndex]
    if (item == null) {
      return
    }
    this.selectItem(item, otherStateToSet, cb)
  }

  selectHighlightedItem = (otherStateToSet, cb) => {
    return this.selectItemAtIndex(
      this.getState().highlightedIndex,
      otherStateToSet,
      cb,
    )
  }

  // any piece of our state can live in two places:
  // 1. Uncontrolled: it's internal (this.state)
  //    We will call this.setState to update that state
  // 2. Controlled: it's external (this.props)
  //    We will call this.props.onStateChange to update that state
  //
  // In addition, we'll call this.props.onChange if the
  // selectedItem is changed.
  internalSetState = (stateToSet, cb) => {
    let isItemSelected, onChangeArg

    const onStateChangeArg = {}
    const isStateToSetFunction = typeof stateToSet === 'function'

    // we want to call `onInputValueChange` before the `setState` call
    // so someone controlling the `inputValue` state gets notified of
    // the input change as soon as possible. This avoids issues with
    // preserving the cursor position.
    // See https://github.com/downshift-js/downshift/issues/217 for more info.
    if (!isStateToSetFunction && stateToSet.hasOwnProperty('inputValue')) {
      this.props.onInputValueChange(stateToSet.inputValue, {
        ...this.getStateAndHelpers(),
        ...stateToSet,
      })
    }
    return this.setState(
      state => {
        state = this.getState(state)
        let newStateToSet = isStateToSetFunction
          ? stateToSet(state)
          : stateToSet

        // Your own function that could modify the state that will be set.
        newStateToSet = this.props.stateReducer(state, newStateToSet)

        // checks if an item is selected, regardless of if it's different from
        // what was selected before
        // used to determine if onSelect and onChange callbacks should be called
        isItemSelected = newStateToSet.hasOwnProperty('selectedItem')
        // this keeps track of the object we want to call with setState
        const nextState = {}
        // this is just used to tell whether the state changed
        const nextFullState = {}
        // we need to call on change if the outside world is controlling any of our state
        // and we're trying to update that state. OR if the selection has changed and we're
        // trying to update the selection
        if (
          isItemSelected &&
          newStateToSet.selectedItem !== state.selectedItem
        ) {
          onChangeArg = newStateToSet.selectedItem
        }
        newStateToSet.type ||= stateChangeTypes.unknown

        Object.keys(newStateToSet).forEach(key => {
          // onStateChangeArg should only have the state that is
          // actually changing
          if (state[key] !== newStateToSet[key]) {
            onStateChangeArg[key] = newStateToSet[key]
          }
          // the type is useful for the onStateChangeArg
          // but we don't actually want to set it in internal state.
          // this is an undocumented feature for now... Not all internalSetState
          // calls support it and I'm not certain we want them to yet.
          // But it enables users controlling the isOpen state to know when
          // the isOpen state changes due to mouseup events which is quite handy.
          if (key === 'type') {
            return
          }
          nextFullState[key] = newStateToSet[key]
          // if it's coming from props, then we don't care to set it internally
          if (!isControlledProp(this.props, key)) {
            nextState[key] = newStateToSet[key]
          }
        })

        // if stateToSet is a function, then we weren't able to call onInputValueChange
        // earlier, so we'll call it now that we know what the inputValue state will be.
        if (
          isStateToSetFunction &&
          newStateToSet.hasOwnProperty('inputValue')
        ) {
          this.props.onInputValueChange(newStateToSet.inputValue, {
            ...this.getStateAndHelpers(),
            ...newStateToSet,
          })
        }

        return nextState
      },
      () => {
        // call the provided callback if it's a function
        cbToCb(cb)()

        // only call the onStateChange and onChange callbacks if
        // we have relevant information to pass them.
        const hasMoreStateThanType = Object.keys(onStateChangeArg).length > 1
        if (hasMoreStateThanType) {
          this.props.onStateChange(onStateChangeArg, this.getStateAndHelpers())
        }

        if (isItemSelected) {
          this.props.onSelect(
            stateToSet.selectedItem,
            this.getStateAndHelpers(),
          )
        }

        if (onChangeArg !== undefined) {
          this.props.onChange(onChangeArg, this.getStateAndHelpers())
        }
        // this is currently undocumented and therefore subject to change
        // We'll try to not break it, but just be warned.
        this.props.onUserAction(onStateChangeArg, this.getStateAndHelpers())
      },
    )
  }

  getStateAndHelpers() {
    const {highlightedIndex, inputValue, selectedItem, isOpen} = this.getState()
    const {itemToString} = this.props
    const {id} = this
    const {
      getRootProps,
      getToggleButtonProps,
      getLabelProps,
      getMenuProps,
      getInputProps,
      getItemProps,
      openMenu,
      closeMenu,
      toggleMenu,
      selectItem,
      selectItemAtIndex,
      selectHighlightedItem,
      setHighlightedIndex,
      clearSelection,
      clearItems,
      reset,
      setItemCount,
      unsetItemCount,
      internalSetState: setState,
    } = this
    return {
      // prop getters
      getRootProps,
      getToggleButtonProps,
      getLabelProps,
      getMenuProps,
      getInputProps,
      getItemProps,

      // actions
      reset,
      openMenu,
      closeMenu,
      toggleMenu,
      selectItem,
      selectItemAtIndex,
      selectHighlightedItem,
      setHighlightedIndex,
      clearSelection,
      clearItems,
      setItemCount,
      unsetItemCount,
      setState,

      // props
      itemToString,

      // derived
      id,

      // state
      highlightedIndex,
      inputValue,
      isOpen,
      selectedItem,
    }
  }

  //////////////////////////// ROOT

  rootRef = node => (this._rootNode = node)

  getRootProps = (
    {refKey = 'ref', ref, ...rest} = {},
    {suppressRefError = false} = {},
  ) => {
    // this is used in the render to know whether the user has called getRootProps.
    // It uses that to know whether to apply the props automatically
    this.getRootProps.called = true
    this.getRootProps.refKey = refKey
    this.getRootProps.suppressRefError = suppressRefError
    const {isOpen} = this.getState()
    return {
      [refKey]: handleRefs(ref, this.rootRef),
      role: 'combobox',
      'aria-expanded': isOpen,
      'aria-haspopup': 'listbox',
      'aria-owns': isOpen ? this.menuId : undefined,
      'aria-labelledby': this.labelId,
      ...rest,
    }
  }

  //\\\\\\\\\\\\\\\\\\\\\\\\\\ ROOT

  keyDownHandlers = {
    ArrowDown(event) {
      event.preventDefault()

      if (this.getState().isOpen) {
        const amount = event.shiftKey ? 5 : 1
        this.moveHighlightedIndex(amount, {
          type: stateChangeTypes.keyDownArrowDown,
        })
      } else {
        this.internalSetState(
          {
            isOpen: true,
            type: stateChangeTypes.keyDownArrowDown,
          },
          () => {
            const itemCount = this.getItemCount()
            if (itemCount > 0) {
              const {highlightedIndex} = this.getState()
              const nextHighlightedIndex = getHighlightedIndex(
                highlightedIndex,
                1,
                {length: itemCount},
                this.isItemDisabled,
                true,
              )

              this.setHighlightedIndex(nextHighlightedIndex, {
                type: stateChangeTypes.keyDownArrowDown,
              })
            }
          },
        )
      }
    },

    ArrowUp(event) {
      event.preventDefault()

      if (this.getState().isOpen) {
        const amount = event.shiftKey ? -5 : -1
        this.moveHighlightedIndex(amount, {
          type: stateChangeTypes.keyDownArrowUp,
        })
      } else {
        this.internalSetState(
          {
            isOpen: true,
            type: stateChangeTypes.keyDownArrowUp,
          },
          () => {
            const itemCount = this.getItemCount()
            if (itemCount > 0) {
              const {highlightedIndex} = this.getState()
              const nextHighlightedIndex = getHighlightedIndex(
                highlightedIndex,
                -1,
                {length: itemCount},
                this.isItemDisabled,
                true,
              )

              this.setHighlightedIndex(nextHighlightedIndex, {
                type: stateChangeTypes.keyDownArrowUp,
              })
            }
          },
        )
      }
    },

    Enter(event) {
      if (event.which === 229) {
        return
      }

      const {isOpen, highlightedIndex} = this.getState()
      if (isOpen && highlightedIndex != null) {
        event.preventDefault()
        const item = this.items[highlightedIndex]
        const itemNode = this.getItemNodeFromIndex(highlightedIndex)
        if (item == null || (itemNode && itemNode.hasAttribute('disabled'))) {
          return
        }
        this.selectHighlightedItem({
          type: stateChangeTypes.keyDownEnter,
        })
      }
    },

    Escape(event) {
      event.preventDefault()
      this.reset({
        type: stateChangeTypes.keyDownEscape,
        ...(!this.state.isOpen && {selectedItem: null, inputValue: ''}),
      })
    },
  }

  //////////////////////////// BUTTON

  buttonKeyDownHandlers = {
    ...this.keyDownHandlers,

    ' '(event) {
      event.preventDefault()
      this.toggleMenu({type: stateChangeTypes.keyDownSpaceButton})
    },
  }

  inputKeyDownHandlers = {
    ...this.keyDownHandlers,
    Home(event) {
      const {isOpen} = this.getState()

      if (!isOpen) {
        return
      }

      event.preventDefault()

      const itemCount = this.getItemCount()

      if (itemCount <= 0 || !isOpen) {
        return
      }

      // get next non-disabled starting downwards from 0 if that's disabled.
      const newHighlightedIndex = getNonDisabledIndex(
        0,
        false,
        {length: itemCount},
        this.isItemDisabled,
      )

      this.setHighlightedIndex(newHighlightedIndex, {
        type: stateChangeTypes.keyDownHome,
      })
    },

    End(event) {
      const {isOpen} = this.getState()

      if (!isOpen) {
        return
      }

      event.preventDefault()

      const itemCount = this.getItemCount()

      if (itemCount <= 0 || !isOpen) {
        return
      }

      // get next non-disabled starting upwards from last index if that's disabled.
      const newHighlightedIndex = getNonDisabledIndex(
        itemCount - 1,
        true,
        {length: itemCount},
        this.isItemDisabled,
      )

      this.setHighlightedIndex(newHighlightedIndex, {
        type: stateChangeTypes.keyDownEnd,
      })
    },
  }

  getToggleButtonProps = ({
    onClick,
    onPress,
    onKeyDown,
    onKeyUp,
    onBlur,
    ...rest
  } = {}) => {
    const {isOpen} = this.getState()
    const enabledEventHandlers =
      isReactNative || isReactNativeWeb
        ? /* istanbul ignore next (react-native) */
          {
            onPress: callAllEventHandlers(onPress, this.buttonHandleClick),
          }
        : {
            onClick: callAllEventHandlers(onClick, this.buttonHandleClick),
            onKeyDown: callAllEventHandlers(
              onKeyDown,
              this.buttonHandleKeyDown,
            ),
            onKeyUp: callAllEventHandlers(onKeyUp, this.buttonHandleKeyUp),
            onBlur: callAllEventHandlers(onBlur, this.buttonHandleBlur),
          }
    const eventHandlers = rest.disabled ? {} : enabledEventHandlers
    return {
      type: 'button',
      role: 'button',
      'aria-label': isOpen ? 'close menu' : 'open menu',
      'aria-haspopup': true,
      'data-toggle': true,
      ...eventHandlers,
      ...rest,
    }
  }

  buttonHandleKeyUp = event => {
    // Prevent click event from emitting in Firefox
    event.preventDefault()
  }

  buttonHandleKeyDown = event => {
    const key = normalizeArrowKey(event)
    if (this.buttonKeyDownHandlers[key]) {
      this.buttonKeyDownHandlers[key].call(this, event)
    }
  }

  buttonHandleClick = event => {
    event.preventDefault()
    // handle odd case for Safari and Firefox which
    // don't give the button the focus properly.
    /* istanbul ignore if (can't reasonably test this) */
    if (!isReactNative && this.props.environment) {
      const {body, activeElement} = this.props.environment.document

      if (body && body === activeElement) {
        event.target.focus()
      }
    }
    // to simplify testing components that use downshift, we'll not wrap this in a setTimeout
    // if the NODE_ENV is test. With the proper build system, this should be dead code eliminated
    // when building for production and should therefore have no impact on production code.
    if (process.env.NODE_ENV === 'test') {
      this.toggleMenu({type: stateChangeTypes.clickButton})
    } else {
      // Ensure that toggle of menu occurs after the potential blur event in iOS
      this.internalSetTimeout(() =>
        this.toggleMenu({type: stateChangeTypes.clickButton}),
      )
    }
  }

  buttonHandleBlur = event => {
    const blurTarget = event.target // Save blur target for comparison with activeElement later
    // Need setTimeout, so that when the user presses Tab, the activeElement is the next focused element, not body element
    this.internalSetTimeout(() => {
      if (this.isMouseDown || !this.props.environment) {
        return
      }

      const {activeElement} = this.props.environment.document

      if (
        (activeElement == null || activeElement.id !== this.inputId) &&
        activeElement !== blurTarget // Do nothing if we refocus the same element again (to solve issue in Safari on iOS)
      ) {
        this.reset({type: stateChangeTypes.blurButton})
      }
    })
  }

  //\\\\\\\\\\\\\\\\\\\\\\\\\\\\\ BUTTON

  /////////////////////////////// LABEL

  getLabelProps = props => {
    return {htmlFor: this.inputId, id: this.labelId, ...props}
  }

  //\\\\\\\\\\\\\\\\\\\\\\\\\\\\\ LABEL

  /////////////////////////////// INPUT

  getInputProps = ({
    onKeyDown,
    onBlur,
    onChange,
    onInput,
    onChangeText,
    ...rest
  } = {}) => {
    let onChangeKey
    let eventHandlers = {}

    /* istanbul ignore next (preact) */
    if (isPreact) {
      onChangeKey = 'onInput'
    } else {
      onChangeKey = 'onChange'
    }
    const {inputValue, isOpen, highlightedIndex} = this.getState()

    if (!rest.disabled) {
      eventHandlers = {
        [onChangeKey]: callAllEventHandlers(
          onChange,
          onInput,
          this.inputHandleChange,
        ),
        onKeyDown: callAllEventHandlers(onKeyDown, this.inputHandleKeyDown),
        onBlur: callAllEventHandlers(onBlur, this.inputHandleBlur),
      }
    }

    /* istanbul ignore if (react-native) */
    if (isReactNative) {
      eventHandlers = {
        onChange: callAllEventHandlers(
          onChange,
          onInput,
          this.inputHandleChange,
        ),
        onChangeText: callAllEventHandlers(onChangeText, onInput, text =>
          this.inputHandleChange({nativeEvent: {text}}),
        ),
        onBlur: callAllEventHandlers(onBlur, this.inputHandleBlur),
      }
    }

    return {
      'aria-autocomplete': 'list',
      'aria-activedescendant':
        isOpen && typeof highlightedIndex === 'number' && highlightedIndex >= 0
          ? this.getItemId(highlightedIndex)
          : undefined,
      'aria-controls': isOpen ? this.menuId : undefined,
      'aria-labelledby': rest && rest['aria-label'] ? undefined : this.labelId,
      // https://developer.mozilla.org/en-US/docs/Web/Security/Securing_your_site/Turning_off_form_autocompletion
      // revert back since autocomplete="nope" is ignored on latest Chrome and Opera
      autoComplete: 'off',
      value: inputValue,
      id: this.inputId,
      ...eventHandlers,
      ...rest,
    }
  }

  inputHandleKeyDown = event => {
    const key = normalizeArrowKey(event)
    if (key && this.inputKeyDownHandlers[key]) {
      this.inputKeyDownHandlers[key].call(this, event)
    }
  }

  inputHandleChange = event => {
    this.internalSetState({
      type: stateChangeTypes.changeInput,
      isOpen: true,
      inputValue:
        isReactNative || isReactNativeWeb
          ? /* istanbul ignore next (react-native) */ event.nativeEvent.text
          : event.target.value,
      highlightedIndex: this.props.defaultHighlightedIndex,
    })
  }

  inputHandleBlur = () => {
    // Need setTimeout, so that when the user presses Tab, the activeElement is the next focused element, not the body element
    this.internalSetTimeout(() => {
      if (this.isMouseDown || !this.props.environment) {
        return
      }

      const {activeElement} = this.props.environment.document
      const downshiftButtonIsActive =
        activeElement?.dataset?.toggle &&
        this._rootNode &&
        this._rootNode.contains(activeElement)

      if (!downshiftButtonIsActive) {
        this.reset({type: stateChangeTypes.blurInput})
      }
    })
  }

  //\\\\\\\\\\\\\\\\\\\\\\\\\\\\\ INPUT

  /////////////////////////////// MENU

  menuRef = node => {
    this._menuNode = node
  }

  getMenuProps = (
    {refKey = 'ref', ref, ...props} = {},
    {suppressRefError = false} = {},
  ) => {
    this.getMenuProps.called = true
    this.getMenuProps.refKey = refKey
    this.getMenuProps.suppressRefError = suppressRefError

    return {
      [refKey]: handleRefs(ref, this.menuRef),
      role: 'listbox',
      'aria-labelledby':
        props && props['aria-label'] ? undefined : this.labelId,
      id: this.menuId,
      ...props,
    }
  }
  //\\\\\\\\\\\\\\\\\\\\\\\\\\\\\ MENU

  /////////////////////////////// ITEM
  getItemProps = ({
    onMouseMove,
    onMouseDown,
    onClick,
    onPress,
    index,
    item = process.env.NODE_ENV === 'production'
      ? /* istanbul ignore next */ undefined
      : requiredProp('getItemProps', 'item'),
    ...rest
  } = {}) => {
    if (index === undefined) {
      this.items.push(item)
      index = this.items.indexOf(item)
    } else {
      this.items[index] = item
    }

    const onSelectKey =
      isReactNative || isReactNativeWeb
        ? /* istanbul ignore next (react-native) */ 'onPress'
        : 'onClick'
    const customClickHandler = isReactNative
      ? /* istanbul ignore next (react-native) */ onPress
      : onClick

    const enabledEventHandlers = {
      // onMouseMove is used over onMouseEnter here. onMouseMove
      // is only triggered on actual mouse movement while onMouseEnter
      // can fire on DOM changes, interrupting keyboard navigation
      onMouseMove: callAllEventHandlers(onMouseMove, () => {
        if (index === this.getState().highlightedIndex) {
          return
        }
        this.setHighlightedIndex(index, {
          type: stateChangeTypes.itemMouseEnter,
        })

        // We never want to manually scroll when changing state based
        // on `onMouseMove` because we will be moving the element out
        // from under the user which is currently scrolling/moving the
        // cursor
        this.avoidScrolling = true
        this.internalSetTimeout(() => (this.avoidScrolling = false), 250)
      }),
      onMouseDown: callAllEventHandlers(onMouseDown, event => {
        // This prevents the activeElement from being changed
        // to the item so it can remain with the current activeElement
        // which is a more common use case.
        event.preventDefault()
      }),
      [onSelectKey]: callAllEventHandlers(customClickHandler, () => {
        this.selectItemAtIndex(index, {
          type: stateChangeTypes.clickItem,
        })
      }),
    }

    // Passing down the onMouseDown handler to prevent redirect
    // of the activeElement if clicking on disabled items
    const eventHandlers = rest.disabled
      ? {onMouseDown: enabledEventHandlers.onMouseDown}
      : enabledEventHandlers

    return {
      id: this.getItemId(index),
      role: 'option',
      'aria-selected': this.getState().highlightedIndex === index,
      ...eventHandlers,
      ...rest,
    }
  }
  //\\\\\\\\\\\\\\\\\\\\\\\\\\\\\ ITEM

  clearItems = () => {
    this.items = []
  }

  reset = (otherStateToSet = {}, cb) => {
    otherStateToSet = pickState(otherStateToSet)
    this.internalSetState(
      ({selectedItem}) => ({
        isOpen: this.props.defaultIsOpen,
        highlightedIndex: this.props.defaultHighlightedIndex,
        inputValue: this.props.itemToString(selectedItem),
        ...otherStateToSet,
      }),
      cb,
    )
  }

  toggleMenu = (otherStateToSet = {}, cb) => {
    otherStateToSet = pickState(otherStateToSet)
    this.internalSetState(
      ({isOpen}) => {
        return {
          isOpen: !isOpen,
          ...(isOpen && {
            highlightedIndex: this.props.defaultHighlightedIndex,
          }),
          ...otherStateToSet,
        }
      },
      () => {
        const {isOpen, highlightedIndex} = this.getState()
        if (isOpen) {
          if (this.getItemCount() > 0 && typeof highlightedIndex === 'number') {
            this.setHighlightedIndex(highlightedIndex, otherStateToSet)
          }
        }
        cbToCb(cb)()
      },
    )
  }

  openMenu = cb => {
    this.internalSetState({isOpen: true}, cb)
  }

  closeMenu = cb => {
    this.internalSetState({isOpen: false}, cb)
  }

  updateStatus = debounce(() => {
    if (!this.props?.environment?.document) {
      return
    }

    const state = this.getState()
    const item = this.items[state.highlightedIndex]
    const resultCount = this.getItemCount()
    const status = this.props.getA11yStatusMessage({
      itemToString: this.props.itemToString,
      previousResultCount: this.previousResultCount,
      resultCount,
      highlightedItem: item,
      ...state,
    })
    this.previousResultCount = resultCount

    setA11yStatus(status, this.props.environment.document)
  }, 200)

  componentDidMount() {
    /* istanbul ignore if (react-native) */
    if (
      process.env.NODE_ENV !== 'production' &&
      !isReactNative &&
      this.getMenuProps.called &&
      !this.getMenuProps.suppressRefError
    ) {
      validateGetMenuPropsCalledCorrectly(this._menuNode, this.getMenuProps)
    }

    /* istanbul ignore if (react-native or SSR) */
    if (isReactNative || !this.props.environment) {
      this.cleanup = () => {
        this.internalClearTimeouts()
      }
    } else {
      // this.isMouseDown helps us track whether the mouse is currently held down.
      // This is useful when the user clicks on an item in the list, but holds the mouse
      // down long enough for the list to disappear (because the blur event fires on the input)
      // this.isMouseDown is used in the blur handler on the input to determine whether the blur event should
      // trigger hiding the menu.
      const onMouseDown = () => {
        this.isMouseDown = true
      }
      const onMouseUp = event => {
        this.isMouseDown = false
        // if the target element or the activeElement is within a downshift node
        // then we don't want to reset downshift
        const contextWithinDownshift = targetWithinDownshift(
          event.target,
          [this._rootNode, this._menuNode],
          this.props.environment,
        )
        if (!contextWithinDownshift && this.getState().isOpen) {
          this.reset({type: stateChangeTypes.mouseUp}, () =>
            this.props.onOuterClick(this.getStateAndHelpers()),
          )
        }
      }
      // Touching an element in iOS gives focus and hover states, but touching out of
      // the element will remove hover, and persist the focus state, resulting in the
      // blur event not being triggered.
      // this.isTouchMove helps us track whether the user is tapping or swiping on a touch screen.
      // If the user taps outside of Downshift, the component should be reset,
      // but not if the user is swiping
      const onTouchStart = () => {
        this.isTouchMove = false
      }

      const onTouchMove = () => {
        this.isTouchMove = true
      }

      const onTouchEnd = event => {
        const contextWithinDownshift = targetWithinDownshift(
          event.target,
          [this._rootNode, this._menuNode],
          this.props.environment,
          false,
        )
        if (
          !this.isTouchMove &&
          !contextWithinDownshift &&
          this.getState().isOpen
        ) {
          this.reset({type: stateChangeTypes.touchEnd}, () =>
            this.props.onOuterClick(this.getStateAndHelpers()),
          )
        }
      }
      const {environment} = this.props

      environment.addEventListener('mousedown', onMouseDown)
      environment.addEventListener('mouseup', onMouseUp)
      environment.addEventListener('touchstart', onTouchStart)
      environment.addEventListener('touchmove', onTouchMove)
      environment.addEventListener('touchend', onTouchEnd)

      this.cleanup = () => {
        this.internalClearTimeouts()
        this.updateStatus.cancel()

        environment.removeEventListener('mousedown', onMouseDown)
        environment.removeEventListener('mouseup', onMouseUp)
        environment.removeEventListener('touchstart', onTouchStart)
        environment.removeEventListener('touchmove', onTouchMove)
        environment.removeEventListener('touchend', onTouchEnd)
      }
    }
  }

  shouldScroll(prevState, prevProps) {
    const {highlightedIndex: currentHighlightedIndex} =
      this.props.highlightedIndex === undefined ? this.getState() : this.props
    const {highlightedIndex: prevHighlightedIndex} =
      prevProps.highlightedIndex === undefined ? prevState : prevProps
    const scrollWhenOpen =
      currentHighlightedIndex && this.getState().isOpen && !prevState.isOpen
    const scrollWhenNavigating =
      currentHighlightedIndex !== prevHighlightedIndex

    return scrollWhenOpen || scrollWhenNavigating
  }

  componentDidUpdate(prevProps, prevState) {
    if (process.env.NODE_ENV !== 'production') {
      validateControlledUnchanged(this.state, prevProps, this.props)
      /* istanbul ignore if (react-native) */
      if (
        !isReactNative &&
        this.getMenuProps.called &&
        !this.getMenuProps.suppressRefError
      ) {
        validateGetMenuPropsCalledCorrectly(this._menuNode, this.getMenuProps)
      }
    }

    if (
      isControlledProp(this.props, 'selectedItem') &&
      this.props.selectedItemChanged(
        prevProps.selectedItem,
        this.props.selectedItem,
      )
    ) {
      this.internalSetState({
        type: stateChangeTypes.controlledPropUpdatedSelectedItem,
        inputValue: this.props.itemToString(this.props.selectedItem),
      })
    }

    if (!this.avoidScrolling && this.shouldScroll(prevState, prevProps)) {
      this.scrollHighlightedItemIntoView()
    }

    /* istanbul ignore else (react-native) */
    if (!isReactNative) {
      this.updateStatus()
    }
  }

  componentWillUnmount() {
    this.cleanup() // avoids memory leak
  }

  render() {
    const children = unwrapArray(this.props.children, noop)
    // because the items are rerendered every time we call the children
    // we clear this out each render and it will be populated again as
    // getItemProps is called.
    this.clearItems()
    // we reset this so we know whether the user calls getRootProps during
    // this render. If they do then we don't need to do anything,
    // if they don't then we need to clone the element they return and
    // apply the props for them.
    this.getRootProps.called = false
    this.getRootProps.refKey = undefined
    this.getRootProps.suppressRefError = undefined
    // we do something similar for getMenuProps
    this.getMenuProps.called = false
    this.getMenuProps.refKey = undefined
    this.getMenuProps.suppressRefError = undefined
    // we do something similar for getLabelProps
    this.getLabelProps.called = false
    // and something similar for getInputProps
    this.getInputProps.called = false
    const element = unwrapArray(children(this.getStateAndHelpers()))
    if (!element) {
      return null
    }

    if (this.getRootProps.called || this.props.suppressRefError) {
      if (
        process.env.NODE_ENV !== 'production' &&
        !this.getRootProps.suppressRefError &&
        !this.props.suppressRefError
      ) {
        validateGetRootPropsCalledCorrectly(element, this.getRootProps)
      }
      return element
    } else if (isDOMElement(element)) {
      // they didn't apply the root props, but we can clone
      // this and apply the props ourselves
      return cloneElement(element, this.getRootProps(getElementProps(element)))
    }

    /* istanbul ignore else */
    if (process.env.NODE_ENV !== 'production') {
      // they didn't apply the root props, but they need to
      // otherwise we can't query around the autocomplete

      throw new Error(
        'downshift: If you return a non-DOM element, you must apply the getRootProps function',
      )
    }

    /* istanbul ignore next */
    return undefined
  }
}

export default Downshift

function validateGetMenuPropsCalledCorrectly(node, {refKey}) {
  if (!node) {
    // eslint-disable-next-line no-console
    console.error(
      `downshift: The ref prop "${refKey}" from getMenuProps was not applied correctly on your menu element.`,
    )
  }
}

function validateGetRootPropsCalledCorrectly(element, {refKey}) {
  const refKeySpecified = refKey !== 'ref'
  const isComposite = !isDOMElement(element)
  if (isComposite && !refKeySpecified && !isForwardRef(element)) {
    // eslint-disable-next-line no-console
    console.error(
      'downshift: You returned a non-DOM element. You must specify a refKey in getRootProps',
    )
  } else if (!isComposite && refKeySpecified) {
    // eslint-disable-next-line no-console
    console.error(
      `downshift: You returned a DOM element. You should not specify a refKey in getRootProps. You specified "${refKey}"`,
    )
  }
  if (!isForwardRef(element) && !getElementProps(element)[refKey]) {
    // eslint-disable-next-line no-console
    console.error(
      `downshift: You must apply the ref prop "${refKey}" from getRootProps onto your root element.`,
    )
  }
}
